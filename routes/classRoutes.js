const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); // Import bcrypt for security
const Classroom = require('../models/Classroom');
const auth = require('../middleware/auth');

// @route   POST /api/class/create
// @desc    Create a new Classroom (Protected)
router.post('/create', async (req, res) => {
    try {
        const { className, adminPin, totalStudents, subjects, timetable } = req.body;

        if (!className || !adminPin || !totalStudents) {
            return res.status(400).json({ error: 'Please provide all required fields' });
        }

        // 1. Hash the PIN before saving
        const salt = await bcrypt.genSalt(10);
        const hashedPin = await bcrypt.hash(adminPin, salt);

        const newClass = new Classroom({
            className,
            adminPin: hashedPin, // Store the hash, not the plain text
            totalStudents,
            subjects,
            timetable
        });

        const savedClass = await newClass.save();

        // Generate token immediately for the creator
        const token = jwt.sign(
            { classId: savedClass._id },
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

// @route   POST /api/class/admin-login
// @desc    Verify Admin PIN and Return Token
router.post('/admin-login', async (req, res) => {
    try {
        const { className, adminPin } = req.body;

        console.log('🔐 Admin login attempt for class:', className);

        const classroom = await Classroom.findOne({
            className: { $regex: new RegExp(`^${className}$`, 'i') }
        });

        if (!classroom) {
            console.log('❌ Class not found:', className);
            return res.status(404).json({ error: 'Class not found' });
        }

        console.log('✅ Class found:', classroom.className, '- Checking PIN...');

        // 3. Compare the provided PIN with the stored Hash
        const isMatch = await bcrypt.compare(adminPin, classroom.adminPin);

        if (!isMatch) {
            console.log('❌ Invalid PIN for class:', className);
            return res.status(401).json({ error: 'Invalid PIN' });
        }

        console.log('✅ PIN verified for class:', className);

        // Generate JWT Token
        const token = jwt.sign(
            { classId: classroom._id },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            message: 'Login successful',
            classId: classroom._id,
            token
        });
    } catch (err) {
        console.error('❌ Admin login error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   POST /api/class/:id/add-subject
// @desc    Add a new subject (Protected)
router.post('/:id/add-subject', auth, async (req, res) => {
    try {
        const { name } = req.body;
        const classId = req.params.id;

        // Verify user owns this class
        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action' });
        }

        const classroom = await Classroom.findById(classId);
        if (!classroom) return res.status(404).json({ error: 'Class not found' });

        classroom.subjects.push({ name });
        await classroom.save();

        res.json({
            message: 'Subject added successfully!',
            subject: classroom.subjects[classroom.subjects.length - 1]
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
        const { name } = req.body;
        const classId = req.params.id;
        const subjectId = req.params.subjectId;

        // Verify user owns this class
        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action' });
        }

        const classroom = await Classroom.findById(classId);
        if (!classroom) return res.status(404).json({ error: 'Class not found' });

        const subject = classroom.subjects.id(subjectId);
        if (!subject) return res.status(404).json({ error: 'Subject not found' });

        subject.name = name;
        await classroom.save();

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
        const classId = req.params.id;
        const subjectId = req.params.subjectId;

        // Verify user owns this class
        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action' });
        }

        const classroom = await Classroom.findById(classId);
        if (!classroom) return res.status(404).json({ error: 'Class not found' });

        // Check if there's only one subject left
        if (classroom.subjects.length === 1) {
            return res.status(400).json({ error: 'Cannot delete the last subject' });
        }

        classroom.subjects.pull(subjectId);
        await classroom.save();

        res.json({
            message: 'Subject deleted successfully!'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});


// @route   PUT /api/class/update-timetable
// @desc    Update the Weekly Timetable (Protected)
router.put('/update-timetable', auth, async (req, res) => {
    try {
        const { classId, timetable } = req.body;

        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action' });
        }

        const classroom = await Classroom.findById(classId);
        if (!classroom) return res.status(404).json({ error: 'Class not found' });

        await Classroom.findByIdAndUpdate(classId, { timetable });

        res.json({ message: "Timetable Updated Successfully! 🗓️" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   PUT /api/class/update-settings
// @desc    Update class settings (Protected)
router.put('/update-settings', auth, async (req, res) => {
    try {
        const { classId, settings, totalStudents } = req.body;

        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action' });
        }

        const updateData = { settings };
        if (totalStudents !== undefined) {
            updateData.totalStudents = totalStudents;
        }

        const classroom = await Classroom.findByIdAndUpdate(
            classId,
            updateData,
            { new: true }
        );

        if (!classroom) {
            return res.status(404).json({ error: 'Class not found' });
        }

        res.json({ message: 'Settings updated successfully', classroom });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

//Public Routes (No Auth Needed)
router.get('/lookup/:className', async (req, res) => {
    try {
        const classroom = await Classroom.findOne({
            className: { $regex: new RegExp(`^${req.params.className}$`, 'i') }
        });

        if (!classroom) {
            return res.status(404).json({ error: 'Class not found' });
        }

        res.json({ classId: classroom._id, className: classroom.className });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   GET /api/class/stats/all
// @desc    Get system statistics (total classes and students)
// NOTE: This MUST be before /:id route to avoid being caught by the dynamic route
router.get('/stats/all', async (req, res) => {
    try {
        const totalClasses = await Classroom.countDocuments();
        const classrooms = await Classroom.find({}, 'totalStudents');
        const totalStudents = classrooms.reduce((sum, c) => sum + c.totalStudents, 0);

        res.json({
            totalClasses,
            totalStudents
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   GET /api/class/teachers/list
// @desc    Get list of all registered teachers (for dropdown selection)
// NOTE: This MUST be before /:id route
router.get('/teachers/list', auth, async (req, res) => {
    try {
        const Teacher = require('../models/Teacher');

        // Get all teachers - only return name and id for privacy
        const teachers = await Teacher.find({}, '_id name email');

        res.json({ teachers });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Dynamic route - MUST be after specific routes like /stats/all and /teachers/list
router.get('/:id', async (req, res) => {
    try {
        const classroom = await Classroom.findById(req.params.id);
        if (!classroom) return res.status(404).json({ error: 'Class not found' });
        res.json(classroom);
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   POST /api/class/assign-teacher
// @desc    Assign a registered teacher to a subject (requires PIN verification)
router.post('/assign-teacher', auth, async (req, res) => {
    try {
        const { teacherId, subjectId, teacherPin } = req.body;

        // Debug: Log the token payload
        console.log('🔑 Token payload:', req.user);

        const classId = req.user.classId;

        // Verify Admin
        if (!classId) {
            console.log('❌ No classId in token! User payload:', req.user);
            return res.status(403).json({ error: 'Access Denied - Please login as admin' });
        }

        const classroom = await Classroom.findById(classId);
        if (!classroom) return res.status(404).json({ error: 'Class not found' });

        // Check if subject exists in class
        const subject = classroom.subjects.id(subjectId);
        if (!subject) return res.status(404).json({ error: 'Subject not found' });

        // Find teacher and verify PIN
        const Teacher = require('../models/Teacher');
        const teacher = await Teacher.findById(teacherId);

        if (!teacher) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        // Verify the PIN
        if (teacher.teacherCode !== teacherPin) {
            return res.status(401).json({ error: 'Invalid PIN. Please ask the teacher to enter their secret code.' });
        }

        // Check if already assigned to this subject
        const isAssigned = teacher.assignedClasses.some(
            a => a.classId.toString() === classId && a.subjectId.toString() === subjectId
        );

        if (!isAssigned) {
            teacher.assignedClasses.push({ classId, subjectId });
            await teacher.save();
        }

        // Link teacher to subject in Classroom
        subject.teacherId = teacher._id;
        subject.teacherName = teacher.name;
        subject.teacherStatus = 'Verified'; // Now verified since PIN was correct
        await classroom.save();

        res.json({
            message: 'Teacher verified and assigned successfully!',
            teacher: {
                name: teacher.name,
                email: teacher.email
            },
            subject: {
                name: subject.name
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   DELETE /api/class/unassign-teacher/:subjectId
// @desc    Remove teacher assignment from a subject
router.delete('/unassign-teacher/:subjectId', auth, async (req, res) => {
    try {
        const { subjectId } = req.params;
        const classId = req.user.classId;

        if (!classId) return res.status(403).json({ error: 'Access Denied' });

        const classroom = await Classroom.findById(classId);
        if (!classroom) return res.status(404).json({ error: 'Class not found' });

        const subject = classroom.subjects.id(subjectId);
        if (!subject) return res.status(404).json({ error: 'Subject not found' });

        // Remove teacher assignment from Teacher model
        if (subject.teacherId) {
            const Teacher = require('../models/Teacher');
            const teacher = await Teacher.findById(subject.teacherId);
            if (teacher) {
                teacher.assignedClasses = teacher.assignedClasses.filter(
                    a => !(a.classId.toString() === classId && a.subjectId.toString() === subjectId)
                );
                await teacher.save();
            }
        }

        // Clear teacher from subject
        subject.teacherId = undefined;
        subject.teacherName = undefined;
        subject.teacherStatus = undefined;
        await classroom.save();

        res.json({ message: 'Teacher unassigned successfully' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;