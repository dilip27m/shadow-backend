const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const auth = require('../middleware/auth'); // Protect marking

// Helper to strip time component
const normalizeDate = (dateString) => {
    const d = new Date(dateString);
    d.setHours(0, 0, 0, 0);
    return d;
};

// @route   POST /api/attendance/mark
// @desc    Mark/Update Attendance (Protected)
router.post('/mark', auth, async (req, res) => {
    try {
        const { classId, date, periods } = req.body;

        if (!classId || !date || !periods) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Use normalized date
        const searchDate = normalizeDate(date);

        const updatedRecord = await Attendance.findOneAndUpdate(
            { classId: classId, date: searchDate },
            { $set: { periods: periods } },
            { new: true, upsert: true }
        );

        res.json({ message: 'Attendance Saved Successfully!', data: updatedRecord });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   GET /api/attendance/by-date/:classId/:date
// @desc    Get attendance for a specific date
router.get('/by-date/:classId/:date', async (req, res) => {
    try {
        const { classId, date } = req.params;
        const searchDate = normalizeDate(date);

        const record = await Attendance.findOne({ classId, date: searchDate });

        if (!record) {
            // Return empty structure instead of 404 for easier frontend handling
            return res.json({ periods: [] });
        }

        res.json(record);
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   GET /api/attendance/dates/:classId
router.get('/dates/:classId', async (req, res) => {
    try {
        const { classId } = req.params;
        const records = await Attendance.find({ classId }).select('date -_id').sort({ date: -1 });

        const dates = records.map(r => r.date);
        res.json({ dates });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;