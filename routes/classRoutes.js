const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); // Import bcrypt for security
const Classroom = require('../models/Classroom');
const auth = require('../middleware/auth');

const sanitizeRollNumber = (value) => {
    if (value === undefined || value === null) return null;
    const cleaned = String(value).trim();
    return cleaned || null;
};

const sanitizeRollNumbers = (values) => {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    const normalized = [];

    values.forEach((value) => {
        const cleaned = sanitizeRollNumber(value);
        if (cleaned && !seen.has(cleaned)) {
            seen.add(cleaned);
            normalized.push(cleaned);
        }
    });

    return normalized;
};

const requireAdminAuth = (req, res) => {
    if (req.user?.role === 'student') {
        res.status(403).json({ error: 'Admin authentication required' });
        return false;
    }
    return true;
};

// @route   POST /api/class/create
// @desc    Create a new Classroom (Protected)
router.post('/create', async (req, res) => {
    try {
        const { className, adminPin, rollNumbers, subjects } = req.body;
        const normalizedRollNumbers = sanitizeRollNumbers(rollNumbers);

        if (!className || !adminPin || normalizedRollNumbers.length === 0) {
            return res.status(400).json({ error: 'Please provide all required fields' });
        }

        // Check for case-insensitive duplicate: "CSE B", "cse b", "Cse B" → same class
        const _className = className.trim();
        const existing = await Classroom.findOne({ className: _className }).collation({ locale: 'en', strength: 2 }).select('_id').lean();
        if (existing) {
            return res.status(400).json({ error: 'Class Name already exists! Please choose another.' });
        }

        // 1. Hash the PIN before saving
        const salt = await bcrypt.genSalt(10);
        const hashedPin = await bcrypt.hash(adminPin, salt);

        const newClass = new Classroom({
            className: _className,
            adminPin: hashedPin, // Store the hash, not the plain text
            rollNumbers: normalizedRollNumbers,
            subjects
        });

        const savedClass = await newClass.save();

        // Generate token immediately for the creator
        const token = jwt.sign(
            { classId: savedClass._id, role: 'admin' },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(201).json({
            message: 'Class Created!',
            classId: savedClass._id,
            token,
            data: savedClass
        });

    } catch (err) {
        // 2. Handle Duplicate Class Name Error
        if (err.code === 11000) {
            return res.status(400).json({ error: 'Class Name already exists! Please choose another.' });
        }
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   PATCH /api/class/:classId/students
// @desc    Add multiple roll numbers to the class without duplicates (Protected)
router.patch('/:classId/students', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const { classId } = req.params;

        // Accept either a single rollNumber or an array of rollNumbers
        const inputRolls = req.body.rollNumbers || (req.body.rollNumber ? [req.body.rollNumber] : []);
        console.log("PATCH /students - inputRolls:", inputRolls, typeof inputRolls, Array.isArray(inputRolls));
        const validRolls = sanitizeRollNumbers(inputRolls);
        console.log("PATCH /students - validRolls:", validRolls);

        if (req.user.classId !== classId) {
            console.log("PATCH /students - 403 user mismatch");
            return res.status(403).json({ error: 'Unauthorized action' });
        }

        if (validRolls.length === 0) {
            console.log("PATCH /students - 400 validRolls length is 0");
            return res.status(400).json({ error: 'At least one valid roll number is required' });
        }

        const updateResult = await Classroom.updateOne(
            { _id: classId },
            { $addToSet: { rollNumbers: { $each: validRolls } } }
        );

        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ error: 'Class not found' });
        }

        const classroom = await Classroom.findById(classId).select('_id className rollNumbers').lean();

        // Re-sort the roll numbers before returning 
        const sortedRolls = [...classroom.rollNumbers].sort((a, b) =>
            String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
        );

        res.json({
            message: updateResult.modifiedCount > 0 ? 'Students added successfully' : 'All roll numbers already exist in this class',
            addedCount: validRolls.length,
            rollNumbers: sortedRolls
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   POST /api/class/admin-login
// @desc    Verify Admin PIN and Return Token
router.post('/admin-login', async (req, res) => {
    try {
        const { className, adminPin } = req.body;
        const _className = (className || '').trim();

        const classroom = await Classroom.findOne({ className: _className })
            .collation({ locale: 'en', strength: 2 })
            .select('className adminPin')
            .lean();

        if (!classroom) {
            return res.status(404).json({ error: 'Class not found' });
        }

        // 3. Compare the provided PIN with the stored Hash
        const isMatch = await bcrypt.compare(adminPin, classroom.adminPin);

        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid PIN' });
        }

        // Generate JWT Token
        const token = jwt.sign(
            { classId: classroom._id, role: 'admin' },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            message: 'Login successful',
            classId: classroom._id,
            token
        });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   POST /api/class/verify-token
// @desc    Verify existing token and issue a fresh one (auto-renewal)
router.post('/verify-token', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        // Token is already verified by auth middleware, req.user has { classId }
        const classroom = await Classroom.findById(req.user.classId).select('className').lean();
        if (!classroom) {
            return res.status(404).json({ error: 'Class not found' });
        }

        // Issue a fresh 30-day token
        const newToken = jwt.sign(
            { classId: classroom._id, role: 'admin' },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            valid: true,
            classId: classroom._id,
            className: classroom.className,
            token: newToken
        });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   POST /api/class/:id/add-subject
// @desc    Add a new subject (Protected)
router.post('/:id/add-subject', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const { name } = req.body;
        const classId = req.params.id;

        // Verify user owns this class
        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action' });
        }

        const existingClass = await Classroom.findById(classId).select('subjects').lean();
        if (!existingClass) return res.status(404).json({ error: 'Class not found' });

        const lowercaseName = name.trim().toLowerCase();
        const isDuplicate = existingClass.subjects.some(sub => sub.name.toLowerCase() === lowercaseName);
        if (isDuplicate) {
            // Return 200 instead of 400 to prevent the browser from logging a red network error to the console,
            // but still pass the 'error' property so the frontend can display the notification bubble.
            return res.status(200).json({ error: 'Subject already exists' });
        }

        const updatedClassroom = await Classroom.findOneAndUpdate(
            { _id: classId },
            { $push: { subjects: { name: name.trim() } } },
            { new: true } // Returns the modified document
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

        // Verify user owns this class
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
            // Return 200 instead of 400 to prevent the browser from logging a red network error to the console
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
        require('fs').appendFileSync('class-error.log', '\n' + new Date().toISOString() + ' EDIT: ' + (err.stack || err.toString()));
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

        // Verify user owns this class
        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action' });
        }

        // First, explicitly check how many subjects exist before pulling, so we don't delete the last one.
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

        res.json({
            message: 'Subject deleted successfully!'
        });
    } catch (err) {
        require('fs').appendFileSync('class-error.log', '\n' + new Date().toISOString() + ' DEL: ' + (err.stack || err.toString()));
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});



// @route   PATCH /api/class/:classId/block-student
// @desc    Block a roll number from student login (privacy opt-out)
router.patch('/:classId/block-student', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const { classId } = req.params;
        const rollNumber = sanitizeRollNumber(req.body.rollNumber);

        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action' });
        }

        if (!rollNumber) {
            return res.status(400).json({ error: 'rollNumber is required' });
        }

        const result = await Classroom.updateOne(
            { _id: classId },
            { $addToSet: { blockedRollNumbers: rollNumber } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Class not found' });
        }

        const classroom = await Classroom.findById(classId).select('blockedRollNumbers').lean();
        res.json({
            message: `Roll number ${rollNumber} blocked successfully`,
            blockedRollNumbers: classroom.blockedRollNumbers || []
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   PATCH /api/class/:classId/unblock-student
// @desc    Unblock a roll number (re-enable student login)
router.patch('/:classId/unblock-student', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const { classId } = req.params;
        const rollNumber = sanitizeRollNumber(req.body.rollNumber);

        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action' });
        }

        if (!rollNumber) {
            return res.status(400).json({ error: 'rollNumber is required' });
        }

        const result = await Classroom.updateOne(
            { _id: classId },
            { $pull: { blockedRollNumbers: rollNumber } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Class not found' });
        }

        const classroom = await Classroom.findById(classId).select('blockedRollNumbers').lean();
        res.json({
            message: `Roll number ${rollNumber} unblocked successfully`,
            blockedRollNumbers: classroom.blockedRollNumbers || []
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});


// --- Public Routes (No Auth Needed) ---

// @route   GET /api/class/stats/all
// @desc    Get system statistics (total classes and students)
// IMPORTANT: Must be defined BEFORE /:id to avoid route collision
router.get('/stats/all', async (req, res) => {
    try {
        const totalClasses = await Classroom.countDocuments();
        const classrooms = await Classroom.find({}, 'rollNumbers totalStudents').lean();
        const totalStudents = classrooms.reduce((sum, c) => {
            if (Array.isArray(c.rollNumbers)) return sum + c.rollNumbers.length;
            if (Number.isFinite(c.totalStudents)) return sum + c.totalStudents;
            return sum;
        }, 0);

        res.json({
            totalClasses,
            totalStudents
        });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/lookup/:className', async (req, res) => {
    try {
        const className = req.params.className;
        const classroom = await Classroom.findOne({ className }).collation({ locale: 'en', strength: 2 }).select('_id className').lean();

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
        const classroom = await Classroom.findById(req.params.id).select('-adminPin').lean();
        if (!classroom) return res.status(404).json({ error: 'Class not found' });
        res.json(classroom);
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;
