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

        const classroom = await Classroom.findOne({
            className: { $regex: new RegExp(`^${className}$`, 'i') }
        });

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

router.get('/:id', async (req, res) => {
    try {
        const classroom = await Classroom.findById(req.params.id);
        if (!classroom) return res.status(404).json({ error: 'Class not found' });
        res.json(classroom);
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   GET /api/class/stats/all
// @desc    Get system statistics (total classes and students)
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

module.exports = router;