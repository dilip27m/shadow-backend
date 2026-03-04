const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Classroom = require('../models/Classroom');
const auth = require('../middleware/auth');
const { sendPushToClass } = require('../utils/pushService');

// FIX: Extract date string directly to avoid timezone-driven day shifts
const normalizeDate = (dateString) => {
    const datePart = String(dateString).split('T')[0];
    return new Date(`${datePart}T00:00:00.000Z`);
};

const sanitizeRollNumber = (value) => {
    if (value === undefined || value === null) return null;
    const cleaned = String(value).trim();
    return cleaned || null;
};

const deduplicateRolls = (arr) => {
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    return arr
        .map((roll) => sanitizeRollNumber(roll))
        .filter((roll) => {
            if (!roll || seen.has(roll)) return false;
            seen.add(roll);
            return true;
        });
};

const normalizePeriodsForStorage = (periods) => {
    if (!Array.isArray(periods)) return [];

    return periods.map((period) => {
        return {
            ...period,
            absentRollNumbers: deduplicateRolls(period.absentRollNumbers),
            // Preserve dutyLeaveRollNumbers if already present on the period object
            dutyLeaveRollNumbers: deduplicateRolls(period.dutyLeaveRollNumbers || [])
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
            await Attendance.findOneAndDelete({ classId: classId, date: searchDate });
            updatedRecord = null;
        } else {
            // When re-saving attendance, preserve existing dutyLeaveRollNumbers for each period
            // so that marking attendance again doesn't wipe DL data
            const existing = await Attendance.findOne({ classId, date: searchDate }).lean();
            const existingDLMap = {};
            if (existing) {
                existing.periods.forEach(p => {
                    existingDLMap[p.periodNum] = deduplicateRolls(p.dutyLeaveRollNumbers || []);
                });
            }

            // Merge: preserve DL rolls from existing record unless the period explicitly sends them
            const mergedPeriods = normalizedPeriods.map(p => ({
                ...p,
                dutyLeaveRollNumbers: p.dutyLeaveRollNumbers?.length
                    ? p.dutyLeaveRollNumbers
                    : (existingDLMap[p.periodNum] || [])
            }));

            updatedRecord = await Attendance.findOneAndUpdate(
                { classId: classId, date: searchDate },
                { $set: { periods: mergedPeriods } },
                { new: true, upsert: true }
            );
        }

        res.json({ message: 'Attendance Saved Successfully!', data: updatedRecord });

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
router.get('/dates/:classId', async (req, res) => {
    try {
        const { classId } = req.params;
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

// @route   POST /api/attendance/duty-leave
// @desc    Apply duty leave to selected rolls for selected periods on a date.
//          Toggles: if a roll is already DL on ALL selected periods, it is removed; otherwise it is added.
// @access  Admin only
router.post('/duty-leave', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;

        const { classId, date, periodNums, rollNumbers } = req.body;

        if (!classId || !date || !periodNums || !rollNumbers) {
            return res.status(400).json({ error: 'Missing required fields: classId, date, periodNums, rollNumbers' });
        }

        if (req.user.classId !== classId) {
            return res.status(403).json({ error: 'Unauthorized action for this class' });
        }

        if (!Array.isArray(periodNums) || periodNums.length === 0) {
            return res.status(400).json({ error: 'periodNums must be a non-empty array' });
        }

        if (!Array.isArray(rollNumbers) || rollNumbers.length === 0) {
            return res.status(400).json({ error: 'rollNumbers must be a non-empty array' });
        }

        const cleanRolls = deduplicateRolls(rollNumbers);
        const searchDate = normalizeDate(date);

        // Attendance must already exist for this date — can't apply DL to a day with no attendance
        const record = await Attendance.findOne({ classId, date: searchDate });
        if (!record) {
            return res.status(404).json({ error: 'No attendance record found for this date. Mark attendance first.' });
        }

        // Determine whether we're adding or removing DL
        // Rule: if ALL selected rolls are already DL on ALL selected periods → remove (toggle off)
        //       otherwise → add
        const targetPeriods = record.periods.filter(p => periodNums.includes(p.periodNum));
        const allAlreadyDL = cleanRolls.every(roll =>
            targetPeriods.every(p =>
                (p.dutyLeaveRollNumbers || []).map(r => sanitizeRollNumber(r)).includes(roll)
            )
        );

        record.periods = record.periods.map(period => {
            if (!periodNums.includes(period.periodNum)) return period;

            let dlRolls = deduplicateRolls(period.dutyLeaveRollNumbers || []);

            if (allAlreadyDL) {
                // Remove these rolls from DL
                dlRolls = dlRolls.filter(r => !cleanRolls.includes(r));
            } else {
                // Add these rolls to DL (deduplicated)
                cleanRolls.forEach(roll => {
                    if (!dlRolls.includes(roll)) dlRolls.push(roll);
                });
            }

            period.dutyLeaveRollNumbers = dlRolls;
            return period;
        });

        record.markModified('periods');
        await record.save();

        const action = allAlreadyDL ? 'removed' : 'applied';
        res.json({
            message: `Duty Leave ${action} successfully`,
            action,
            data: record
        });

    } catch (err) {
        console.error('Duty Leave Error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;