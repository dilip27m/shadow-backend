const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Classroom = require('../models/Classroom');
const auth = require('../middleware/auth'); // Import the new middleware

// @route   POST /api/class/create
// @desc    Create a new Classroom (Protected)
router.post('/create', async (req, res) => {
    try {
        const { className, adminPin, totalStudents, subjects, timetable } = req.body;

        if (!className || !adminPin || !totalStudents) {
            return res.status(400).json({ error: 'Please provide all required fields' });
        }

        const newClass = new Classroom({
            className,
            adminPin,
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
            token, // Return token so they are logged in
            data: savedClass
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

        const classroom = await Classroom.findOne({
            className: { $regex: new RegExp(`^${className}$`, 'i') }
        });

        if (!classroom) {
            return res.status(404).json({ error: 'Class not found' });
        }

        if (classroom.adminPin !== adminPin) {
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
            token // Send token to frontend
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

// @route   PUT /api/class/update-timetable
// @desc    Update the Weekly Timetable (Protected)
router.put('/update-timetable', auth, async (req, res) => {
    try {
        const { classId, timetable } = req.body;

        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action' });
        }

        // Basic Validation: Ensure subjectIds exist (Optional improvement)
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
        const { classId, settings } = req.body;

        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action' });
        }

        const classroom = await Classroom.findByIdAndUpdate(
            classId,
            { settings },
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

module.exports = router;