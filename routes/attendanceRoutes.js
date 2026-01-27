const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const auth = require('../middleware/auth');

// FIX: Force UTC Midnight to avoid timezone shifts
const normalizeDate = (dateString) => {
    // Ensure we only take the YYYY-MM-DD part and force UTC
    const datePart = new Date(dateString).toISOString().split('T')[0];
    return new Date(`${datePart}T00:00:00.000Z`);
};

// @route   POST /api/attendance/mark
router.post('/mark', auth, async (req, res) => {
    try {
        const { classId, date, periods } = req.body;

        if (!classId || !date || !periods) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

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
router.get('/by-date/:classId/:date', async (req, res) => {
    try {
        const { classId, date } = req.params;
        const searchDate = normalizeDate(date);

        const record = await Attendance.findOne({ classId, date: searchDate });

        if (!record) {
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