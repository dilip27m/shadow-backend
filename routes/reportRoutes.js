const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const Classroom = require('../models/Classroom');
const auth = require('../middleware/auth');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

// Rate limit for report submissions — 5 per 15 minutes per IP
const reportLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many reports submitted. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const sanitizeRollNumber = (value) => {
    if (value === undefined || value === null) return null;
    const cleaned = String(value).trim();
    return cleaned || null;
};

const getClassRollNumbers = (classroom) => {
    if (Array.isArray(classroom?.rollNumbers) && classroom.rollNumbers.length > 0) {
        return classroom.rollNumbers
            .map((roll) => sanitizeRollNumber(roll))
            .filter(Boolean);
    }

    const totalStudents = Number(classroom?.totalStudents);
    if (Number.isInteger(totalStudents) && totalStudents > 0) {
        return Array.from({ length: totalStudents }, (_, index) => String(index + 1));
    }

    return [];
};

const isSameRollNumber = (left, right) => {
    const a = sanitizeRollNumber(left);
    const b = sanitizeRollNumber(right);
    if (!a || !b) return false;
    if (a === b) return true;
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Number(a) === Number(b);
    return false;
};

const requireStudentAuth = (req, res) => {
    if (req.user?.role !== 'student') {
        res.status(403).json({ error: 'Student authentication required' });
        return false;
    }
    return true;
};

const requireAdminAuth = (req, res) => {
    if (req.user?.role === 'student') {
        res.status(403).json({ error: 'Admin authentication required' });
        return false;
    }
    return true;
};

// Submit a new report
router.post('/submit', reportLimiter, auth, async (req, res) => {
    try {
        if (!requireStudentAuth(req, res)) return;
        const { date, subjectId, subjectName, issueDescription } = req.body;
        const classId = req.user.classId;
        const normalizedStudentRoll = sanitizeRollNumber(req.user.rollNumber);


        // Validate required fields
        if (!classId || !normalizedStudentRoll || !date || !subjectId || !subjectName || !issueDescription) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check if class exists
        const classroom = await Classroom.findById(classId).select('_id rollNumbers totalStudents').lean();
        if (!classroom) {
            return res.status(404).json({ error: 'Class not found' });
        }

        const classRollNumbers = getClassRollNumbers(classroom);
        if (!classRollNumbers.includes(normalizedStudentRoll)) {
            return res.status(404).json({ error: 'Student not found in this class' });
        }

        // Create new report
        const report = new Report({
            classId,
            studentRoll: normalizedStudentRoll,
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

// Get all reports for a class (admin use) - Protected
router.get('/class/:classId', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const { classId } = req.params;

        // Validate Class ID
        if (!mongoose.Types.ObjectId.isValid(classId)) {
            return res.status(400).json({ error: 'Invalid Class ID' });
        }

        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action for this class' });
        }

        const reports = await Report.find({ classId }).sort({ createdAt: -1 }).lean();
        res.json({ reports });
    } catch (err) {
        console.error('Error fetching class reports:', err);
        res.status(500).json({ error: 'Failed to fetch reports', details: err.message });
    }
});

// Get all reports for a specific student
router.get('/:classId/:rollNumber', auth, async (req, res) => {
    try {
        if (!requireStudentAuth(req, res)) return;
        const { classId, rollNumber } = req.params;
        const normalizedRollNumber = sanitizeRollNumber(rollNumber);

        if (!normalizedRollNumber) {
            return res.status(400).json({ error: 'Invalid Roll Number' });
        }

        if (req.user.classId !== classId || !isSameRollNumber(req.user.rollNumber, normalizedRollNumber)) {
            return res.status(403).json({ error: 'Unauthorized access to reports' });
        }

        const rollQuery = /^\d+$/.test(normalizedRollNumber)
            ? { $in: [normalizedRollNumber, Number(normalizedRollNumber)] }
            : normalizedRollNumber;

        const reports = await Report.find({
            classId,
            studentRoll: rollQuery
        }).sort({ createdAt: -1 }).lean(); // Most recent first

        res.json({ reports });
    } catch (err) {
        console.error('Error fetching reports:', err);
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

// Update report status (admin use) - Protected
router.patch('/:reportId', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const { reportId } = req.params;
        const { status, adminResponse } = req.body;

        const report = await Report.findById(reportId);
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }

        // Verify the report belongs to the authenticated admin's class
        if (report.classId.toString() !== req.user.classId) {
            return res.status(403).json({ error: 'Unauthorized — report belongs to another class' });
        }

        if (status) {
            report.status = status;
            // Stamp resolvedAt when admin responds — TTL will auto-delete 7 days later
            if (status === 'resolved' || status === 'rejected') {
                report.resolvedAt = new Date();
            }
        }
        if (adminResponse) report.adminResponse = adminResponse;

        await report.save();

        res.json({
            message: 'Report updated successfully',
            report
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update report' });
    }
});

// Delete report (Student use)
router.delete('/delete/:reportId', auth, async (req, res) => {
    try {
        if (!requireStudentAuth(req, res)) return;
        const { reportId } = req.params;
        const normalizedStudentRoll = sanitizeRollNumber(req.user.rollNumber);

        if (!normalizedStudentRoll) {
            return res.status(400).json({ error: 'Invalid student roll number' });
        }

        const report = await Report.findById(reportId);

        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }

        if (report.classId.toString() !== req.user.classId) {
            return res.status(403).json({ error: 'Unauthorized to delete this report' });
        }

        // Make sure only the student who created it can delete it
        if (!isSameRollNumber(report.studentRoll, normalizedStudentRoll)) {
            return res.status(403).json({ error: 'Unauthorized to delete this report' });
        }

        // Optional: only let them delete if it's resolved or rejected
        if (report.status === 'pending') {
            return res.status(400).json({ error: 'Cannot delete a pending report. Wait for admin to resolve it.' });
        }

        await Report.findByIdAndDelete(reportId);

        res.json({ message: 'Report deleted successfully' });
    } catch (err) {
        console.error('Error deleting report:', err);
        res.status(500).json({ error: 'Failed to delete report' });
    }
});

// Edit report (Student use)
router.patch('/edit/:reportId', reportLimiter, auth, async (req, res) => {
    try {
        if (!requireStudentAuth(req, res)) return;
        const { reportId } = req.params;
        const { date, subjectId, subjectName, issueDescription } = req.body;
        const normalizedStudentRoll = sanitizeRollNumber(req.user.rollNumber);

        if (!normalizedStudentRoll) {
            return res.status(400).json({ error: 'Invalid student roll number' });
        }

        const report = await Report.findById(reportId);

        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }

        if (report.classId.toString() !== req.user.classId) {
            return res.status(403).json({ error: 'Unauthorized to edit this report' });
        }

        // Verify ownership
        if (!isSameRollNumber(report.studentRoll, normalizedStudentRoll)) {
            return res.status(403).json({ error: 'Unauthorized to edit this report' });
        }

        // Only allow edits on pending reports
        if (report.status !== 'pending') {
            return res.status(400).json({ error: 'Cannot edit a resolved or rejected report' });
        }

        if (date) report.date = date;
        if (subjectId) report.subjectId = subjectId;
        if (subjectName) report.subjectName = subjectName;
        if (issueDescription) report.issueDescription = issueDescription;

        await report.save();

        res.json({
            message: 'Report updated successfully',
            report
        });
    } catch (err) {
        console.error('Error editing report:', err);
        res.status(500).json({ error: 'Failed to update report' });
    }
});

module.exports = router;
