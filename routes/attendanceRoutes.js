const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Classroom = require('../models/Classroom');
const auth = require('../middleware/auth');
const { sendPushToClass } = require('../utils/pushService');

// FIX: Extract date string directly to avoid timezone-driven day shifts
const normalizeDate = (dateString) => {
    // Take only the YYYY-MM-DD part before any 'T' character, avoiding UTC conversion
    const datePart = String(dateString).split('T')[0];
    return new Date(`${datePart}T00:00:00.000Z`);
};

const sanitizeRollNumber = (value) => {
    if (value === undefined || value === null) return null;
    const cleaned = String(value).trim();
    return cleaned || null;
};

const normalizePeriodsForStorage = (periods) => {
    if (!Array.isArray(periods)) return [];

    return periods.map((period) => {
        const seen = new Set();
        const absentRollNumbers = Array.isArray(period.absentRollNumbers)
            ? period.absentRollNumbers
                .map((roll) => sanitizeRollNumber(roll))
                .filter((roll) => {
                    if (!roll || seen.has(roll)) return false;
                    seen.add(roll);
                    return true;
                })
            : [];

        return {
            ...period,
            absentRollNumbers
        };
    });
};

const requireAdminAuth = (req, res) => {
    if (req.user?.role === 'student') {
        res.status(403).json({ error: 'Admin authentication required' });
        return false;
    }
    return true;
};

// @route   POST /api/attendance/mark
router.post('/mark', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const { classId, date, periods } = req.body;

        if (!classId || !date || !periods) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action for this class' });
        }

        const searchDate = normalizeDate(date);
        const normalizedPeriods = normalizePeriodsForStorage(periods);

        let updatedRecord;
        if (normalizedPeriods.length === 0) {
            // Delete the entire attendance document if there are no periods
            await Attendance.findOneAndDelete({ classId: classId, date: searchDate });
            updatedRecord = null;
        } else {
            updatedRecord = await Attendance.findOneAndUpdate(
                { classId: classId, date: searchDate },
                { $set: { periods: normalizedPeriods } },
                { new: true, upsert: true }
            );
        }

        res.json({ message: 'Attendance Saved Successfully!', data: updatedRecord });

        // Send push notifications (non-blocking, fire-and-forget)
        if (normalizedPeriods.length > 0) {
            Classroom.findById(classId).select('className').lean()
                .then(cls => {
                    const name = cls?.className || 'your class';
                    const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric'
                    });
                    sendPushToClass(classId, {
                        title: `📋 Attendance Updated`,
                        body: `${name} — ${dateLabel}`,
                        url: '/'
                    });
                })
                .catch(() => { });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   GET /api/attendance/by-date/:classId/:date
// @access  Public — intentionally unauthenticated so students can view attendance
//          Students do not have auth tokens; they access via classId + rollNumber
router.get('/by-date/:classId/:date', async (req, res) => {
    try {
        const { classId, date } = req.params;
        const searchDate = normalizeDate(date);

        const record = await Attendance.findOne({ classId, date: searchDate }).lean();

        if (!record) {
            return res.json({ periods: [] });
        }

        res.json(record);
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   GET /api/attendance/dates/:classId
// @access  Public — students use this to populate the calendar view
router.get('/dates/:classId', async (req, res) => {
    try {
        const { classId } = req.params;
        // Only return dates that actually have periods stored
        const records = await Attendance.find({
            classId,
            periods: { $exists: true, $not: { $size: 0 } }
        }).select('date -_id').sort({ date: -1 }).lean();

        const dates = records.map(r => r.date);
        res.json({ dates });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;
