const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const Classroom = require('../models/Classroom');
const auth = require('../middleware/auth');

// Submit a new report
router.post('/submit', async (req, res) => {
    try {
        const { classId, studentRoll, date, subjectId, subjectName, issueDescription } = req.body;

        // Validate required fields
        if (!classId || !studentRoll || !date || !subjectId || !subjectName || !issueDescription) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check if class exists
        const classroom = await Classroom.findById(classId);
        if (!classroom) {
            return res.status(404).json({ error: 'Class not found' });
        }

        // Create new report
        const report = new Report({
            classId,
            studentRoll,
            date,
            subjectId,
            subjectName,
            issueDescription,
            status: 'pending'
        });

        await report.save();

        res.status(201).json({
            message: 'Report submitted successfully',
            report
        });
    } catch (err) {
        console.error('Error submitting report:', err);
        res.status(500).json({ error: 'Failed to submit report' });
    }
});

// Get all reports for a specific student
router.get('/:classId/:rollNumber', async (req, res) => {
    try {
        const { classId, rollNumber } = req.params;

        const reports = await Report.find({
            classId,
            studentRoll: parseInt(rollNumber)
        }).sort({ createdAt: -1 }); // Most recent first

        res.json({ reports });
    } catch (err) {
        console.error('Error fetching reports:', err);
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

// Get all reports for a class (admin use) - Protected
router.get('/class/:classId', auth, async (req, res) => {
    try {
        const { classId } = req.params;

        const reports = await Report.find({ classId })
            .sort({ createdAt: -1 });

        res.json({ reports });
    } catch (err) {
        console.error('Error fetching class reports:', err);
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

// Update report status (admin use) - Protected
router.patch('/:reportId', auth, async (req, res) => {
    try {
        const { reportId } = req.params;
        const { status, adminResponse } = req.body;

        const report = await Report.findById(reportId);
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }

        if (status) report.status = status;
        if (adminResponse) report.adminResponse = adminResponse;

        await report.save();

        res.json({
            message: 'Report updated successfully',
            report
        });
    } catch (err) {
        console.error('Error updating report:', err);
        res.status(500).json({ error: 'Failed to update report' });
    }
});

module.exports = router;
