const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const Classroom = require('../models/Classroom');
const Student = require('../models/Student');
const Attendance = require('../models/Attendance');
const Announcement = require('../models/Announcement');
const Report = require('../models/Report');
const PushSubscription = require('../models/PushSubscription');
const auth = require('../middleware/auth');
const { generateStudentProvisioning } = require('../utils/generateStudentProvisioning');

// ─── Super Admin Middleware ───────────────────────────────────────────────────
const superAdminAuth = (req, res, next) => {
    const key = req.headers['x-super-admin-key'];
    if (!key || key !== process.env.SUPER_ADMIN_MASTER_KEY) {
        return res.status(401).json({ error: 'Unauthorized: Invalid Super Admin Key' });
    }
    next();
};

// ─── Zod Validation Schemas ──────────────────────────────────────────────────

const createClassSchema = z.object({
    className: z.string().trim().min(1, 'Class name is required'),
    semester: z.number().int().min(1, 'Semester must be between 1 and 8').max(8, 'Semester must be between 1 and 8'),
    academicYear: z.string().trim().min(1, 'Academic year is required'),
    adminEmail: z.string().trim().toLowerCase().min(1, 'Admin email is required').email('Invalid email format'),
    adminPassword: z.string().min(8, 'Admin password must be at least 8 characters'),
    subjects: z.array(z.object({
        name: z.string().trim().min(1, 'Subject name is required'),
        code: z.string().trim().optional()
    })).optional().default([]),
    rangeConfig: z.object({
        start: z.string().trim().min(1, 'Start roll number is required'),
        end: z.string().trim().min(1, 'End roll number is required'),
        emailTemplate: z.string().trim().optional()
    })
});

// ─── Helper: format Zod errors ───────────────────────────────────────────────
const formatZodErrors = (error) => {
    return error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message
    }));
};

const requireAdminAuth = (req, res) => {
    if (req.user?.role === 'student') {
        res.status(403).json({ error: 'Admin authentication required' });
        return false;
    }
    return true;
};

// ═════════════════════════════════════════════════════════════════════════════
//  SUPER ADMIN ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// @route   GET /api/class/super-admin/classes
// @desc    List all classes (Super Admin only)
router.get('/super-admin/classes', superAdminAuth, async (req, res) => {
    try {
        const classes = await Classroom.find({})
            .select('_id className semester academicYear isApproved createdAt')
            .sort({ createdAt: -1 })
            .lean();
        res.json({ classes });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   PATCH /api/class/approve/:classId
// @desc    Approve a pending class and bulk-create unclaimed Student documents (Super Admin only)
router.patch('/approve/:classId', superAdminAuth, async (req, res) => {
    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        // 1. Find the pending classroom
        const classroom = await Classroom.findById(req.params.classId).session(session);

        if (!classroom) {
            await session.abortTransaction();
            return res.status(404).json({ error: 'Classroom not found' });
        }

        if (classroom.isApproved) {
            await session.abortTransaction();
            return res.status(400).json({ error: 'Classroom is already approved' });
        }

        // 2. Generate student provisioning with secret keys
        let provisionedStudents;
        try {
            provisionedStudents = await generateStudentProvisioning(
                classroom.rangeConfig.start,
                classroom.rangeConfig.end
            );
        } catch (genErr) {
            await session.abortTransaction();
            return res.status(400).json({ error: `Student provisioning failed: ${genErr.message}` });
        }

        if (provisionedStudents.length === 0) {
            await session.abortTransaction();
            return res.status(400).json({ error: 'Generated student list is empty' });
        }

        // 3. Approve the classroom
        classroom.isApproved = true;
        await classroom.save({ session });

        // 4. Bulk-insert Student documents with hashed secret keys
        const studentDocs = provisionedStudents.map(({ rollNumber, hashedKey }) => ({
            rollNumber,
            classId: classroom._id,
            secretKey: hashedKey, // Already hashed by generateStudentProvisioning
            isClaimed: false
        }));

        // Use rawResult to skip pre-save hooks (keys are already hashed)
        await Student.insertMany(studentDocs, { session });

        // 5. Commit
        await session.commitTransaction();

        // 6. Return plain-text key list (ONE-TIME ONLY — never stored in plain text)
        const keyList = provisionedStudents.map(({ rollNumber, plainKey }) => ({
            rollNumber,
            secretKey: plainKey
        }));

        res.json({
            message: `Classroom "${classroom.className}" approved. ${provisionedStudents.length} student accounts provisioned.`,
            classId: classroom._id,
            studentsCreated: provisionedStudents.length,
            keyList // ⚠️ Plain-text keys — distribute to admin, never stored again
        });

    } catch (err) {
        await session.abortTransaction();

        if (err.code === 11000) {
            return res.status(409).json({
                error: 'Some students already exist in the database. Approval rolled back.',
                details: err.message
            });
        }

        console.error('Approval transaction error:', err);
        res.status(500).json({ error: 'Server Error' });
    } finally {
        session.endSession();
    }
});

// @route   DELETE /api/class/super-admin/purge/:classId
// @desc    Cascade delete a class and ALL its associated data (Super Admin only)
router.delete('/super-admin/purge/:classId', superAdminAuth, async (req, res) => {
    try {
        const { classId } = req.params;

        const classroom = await Classroom.findById(classId).select('className').lean();
        if (!classroom) {
            return res.status(404).json({ error: 'Class not found' });
        }

        // Cascade delete across all collections (including Students now)
        const [attResult, annResult, repResult, pushResult, stuResult] = await Promise.all([
            Attendance.deleteMany({ classId }),
            Announcement.deleteMany({ classId }),
            Report.deleteMany({ classId }),
            PushSubscription.deleteMany({ classId }),
            Student.deleteMany({ classId }),
        ]);

        await Classroom.findByIdAndDelete(classId);

        res.json({
            message: `Class "${classroom.className}" and all associated data purged successfully.`,
            className: classroom.className,
            deleted: {
                attendances: attResult.deletedCount,
                announcements: annResult.deletedCount,
                reports: repResult.deletedCount,
                pushSubscriptions: pushResult.deletedCount,
                students: stuResult.deletedCount,
            },
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
//  CLASS CREATION
// ═════════════════════════════════════════════════════════════════════════════

// @route   POST /api/class/create
// @desc    Create a new Classroom (pending approval) with student range config
router.post('/create', async (req, res) => {
    try {
        // 1. Validate request body with Zod
        const parsed = createClassSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: formatZodErrors(parsed.error)
            });
        }

        const { className, semester, academicYear, adminEmail, adminPassword, subjects, rangeConfig } = parsed.data;

        // 2. Validate the roll-number range eagerly (fail fast)
        let studentPreview;
        try {
            studentPreview = await generateStudentProvisioning(rangeConfig.start, rangeConfig.end);
        } catch (rangeErr) {
            return res.status(400).json({ error: rangeErr.message });
        }

        // 3. Check for case-insensitive duplicate
        const existing = await Classroom.findOne({ className })
            .collation({ locale: 'en', strength: 2 })
            .select('_id')
            .lean();

        if (existing) {
            return res.status(400).json({ error: 'Class Name already exists! Please choose another.' });
        }

        // 4. Save classroom (unapproved, with admin credentials)
        const newClass = new Classroom({
            className,
            semester,
            academicYear,
            adminEmail,
            adminPassword,
            subjects,
            rangeConfig,
            isApproved: false
        });

        const savedClass = await newClass.save();

        // 5. Placeholder: send verification email to admin's college email
        console.log(`[EMAIL PLACEHOLDER] Class "${className}" created, pending Super Admin approval.`);

        res.status(201).json({
            message: 'Class created successfully! Pending Super Admin approval.',
            classId: savedClass._id,
            className: savedClass.className,
            isApproved: false,
            studentCount: studentPreview.length,
            studentPreview: studentPreview.slice(0, 5) // Show first 5 as preview
        });

    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ error: 'Class Name already exists! Please choose another.' });
        }
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
//  SUBJECT MANAGEMENT (Active — works with new schema)
// ═════════════════════════════════════════════════════════════════════════════

// @route   POST /api/class/:id/add-subject
// @desc    Add a new subject (Protected)
router.post('/:id/add-subject', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const { name } = req.body;
        const classId = req.params.id;

        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action' });
        }

        const existingClass = await Classroom.findById(classId).select('subjects').lean();
        if (!existingClass) return res.status(404).json({ error: 'Class not found' });

        const lowercaseName = name.trim().toLowerCase();
        const isDuplicate = existingClass.subjects.some(sub => sub.name.toLowerCase() === lowercaseName);
        if (isDuplicate) {
            return res.status(200).json({ error: 'Subject already exists' });
        }

        const updatedClassroom = await Classroom.findOneAndUpdate(
            { _id: classId },
            { $push: { subjects: { name: name.trim() } } },
            { new: true }
        );

        if (!updatedClassroom) {
            return res.status(404).json({ error: 'Class not found' });
        }

        res.json({
            message: 'Subject added successfully!',
            subject: updatedClassroom.subjects[updatedClassroom.subjects.length - 1]
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   PUT /api/class/:id/edit-subject/:subjectId
// @desc    Edit an existing subject (Protected)
router.put('/:id/edit-subject/:subjectId', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const { name } = req.body;
        const classId = req.params.id;
        const subjectId = req.params.subjectId;

        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action' });
        }

        const existingClass = await Classroom.findById(classId).select('subjects').lean();
        if (!existingClass) return res.status(404).json({ error: 'Class not found' });

        const lowercaseName = name.trim().toLowerCase();
        const isDuplicate = existingClass.subjects.some(sub =>
            sub._id.toString() !== subjectId && sub.name.toLowerCase() === lowercaseName
        );
        if (isDuplicate) {
            return res.status(200).json({ error: 'Subject already exists' });
        }

        const updatedClassroom = await Classroom.findOneAndUpdate(
            { _id: classId, 'subjects._id': subjectId },
            { $set: { 'subjects.$.name': name.trim() } },
            { new: true }
        );

        if (!updatedClassroom) {
            return res.status(404).json({ error: 'Class or Subject not found' });
        }

        const subject = updatedClassroom.subjects.find(s => s._id.toString() === subjectId);

        res.json({
            message: 'Subject updated successfully!',
            subject: subject
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   DELETE /api/class/:id/delete-subject/:subjectId
// @desc    Delete a subject (Protected)
router.delete('/:id/delete-subject/:subjectId', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const classId = req.params.id;
        const subjectId = req.params.subjectId;

        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action' });
        }

        const classroomCheck = await Classroom.findById(classId).select('subjects').lean();
        if (!classroomCheck) return res.status(404).json({ error: 'Class not found' });

        if (classroomCheck.subjects.length <= 1) {
            return res.status(400).json({ error: 'Cannot delete the last subject' });
        }

        const updatedClassroom = await Classroom.findOneAndUpdate(
            { _id: classId },
            { $pull: { subjects: { _id: subjectId } } },
            { new: true }
        );

        if (!updatedClassroom) {
            return res.status(404).json({ error: 'Failed to delete. Class not found.' });
        }

        res.json({ message: 'Subject deleted successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// @route   GET /api/class/stats/all
// @desc    Get system statistics (total classes and students)
// IMPORTANT: Must be defined BEFORE /:id to avoid route collision
router.get('/stats/all', async (req, res) => {
    try {
        const [totalClasses, totalStudents] = await Promise.all([
            Classroom.countDocuments({ isApproved: true }),
            Student.countDocuments()
        ]);

        res.json({ totalClasses, totalStudents });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/lookup/:className', async (req, res) => {
    try {
        const className = req.params.className;
        const classroom = await Classroom.findOne({ className, isApproved: true })
            .collation({ locale: 'en', strength: 2 })
            .select('_id className')
            .lean();

        if (!classroom) {
            return res.status(404).json({ error: 'Class not found' });
        }

        res.json({ classId: classroom._id, className: classroom.className });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// Catch-all by ID — must be LAST among GET routes
router.get('/:id', async (req, res) => {
    try {
        const classroom = await Classroom.findById(req.params.id)
            .select('-rangeConfig')
            .lean();
        if (!classroom) return res.status(404).json({ error: 'Class not found' });
        res.json(classroom);
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
//  [LEGACY] Routes below are preserved for reference during migration.
//  They depend on the old schema fields (adminPin, rollNumbers, blockedRollNumbers)
//  which have been removed. Uncomment and adapt when needed.
// ═════════════════════════════════════════════════════════════════════════════

/*
// [LEGACY] @route POST /api/class/admin-login
// [LEGACY] @desc  Verify Admin PIN and Return Token
router.post('/admin-login', async (req, res) => { ... });

// [LEGACY] @route POST /api/class/verify-token
router.post('/verify-token', auth, async (req, res) => { ... });

// [LEGACY] @route PATCH /api/class/:classId/students
// [LEGACY] @desc  Add multiple roll numbers to the class
router.patch('/:classId/students', auth, async (req, res) => { ... });

// [LEGACY] @route PATCH /api/class/:classId/block-student
router.patch('/:classId/block-student', auth, async (req, res) => { ... });

// [LEGACY] @route PATCH /api/class/:classId/unblock-student
router.patch('/:classId/unblock-student', auth, async (req, res) => { ... });
*/

// @route   GET /api/class/public/list
// @desc    Return approved classes (name + id only) for public dropdowns
router.get('/public/list', async (req, res) => {
    try {
        const classes = await Classroom.find({ isApproved: true })
            .select('_id className')
            .sort({ className: 1 })
            .lean();

        res.json({ classes });
    } catch (err) {
        console.error('Public class list error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;
