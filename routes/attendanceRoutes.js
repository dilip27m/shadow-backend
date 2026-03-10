const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Classroom = require('../models/Classroom');
const StudentRecord = require('../models/StudentRecord');
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
    return periods.map((period) => ({
        ...period,
        absentRollNumbers: deduplicateRolls(period.absentRollNumbers),
        dutyLeaveRollNumbers: deduplicateRolls(period.dutyLeaveRollNumbers || [])
    }));
};

const requireAdminAuth = (req, res) => {
    if (req.user?.role === 'student') {
        res.status(403).json({ error: 'Admin authentication required' });
        return false;
    }
    return true;
};

/**
 * Derive the attendance status for a single student in a single period.
 * - Not in absentRollNumbers           → 'Present'
 * - In absentRollNumbers + in DL list  → 'Present (DL)'  (counts as attended)
 * - In absentRollNumbers only          → 'Absent'
 */
const getPeriodStatus = (period, rollNumber) => {
    const absentSet = new Set(deduplicateRolls(period.absentRollNumbers));
    const dlSet = new Set(deduplicateRolls(period.dutyLeaveRollNumbers || []));
    const isAbsent = absentSet.has(rollNumber);
    const isDL = dlSet.has(rollNumber);

    if (!isAbsent) return 'Present';
    if (isDL) return 'Present (DL)';
    return 'Absent';
};

/**
 * Sync StudentRecord documents for all students in a class for a given date.
 * Correctly handles 'Present (DL)' status and counts DL as attended in subject stats.
 */
const syncStudentRecords = async (classId, searchDate, periodsToSync, session) => {
    const classroom = await Classroom.findById(classId)
        .select('rollNumbers subjects totalStudents')
        .session(session)
        .lean();

    if (!classroom) return;

    const rollNumbers = getClassRollNumbers(classroom);

    if (rollNumbers.length === 0) return;

    const subjectMap = {};
    (classroom.subjects || []).forEach(s => {
        subjectMap[s._id.toString()] = s.name;
    });

    // Phase 1: Upsert skeleton records (ensures documents exist before update)
    const upsertOps = rollNumbers.map(rollNumber => ({
        updateOne: {
            filter: { classId: new mongoose.Types.ObjectId(classId), rollNumber },
            update: {
                $set: { lastSyncedAt: new Date() },
                $setOnInsert: { classId: new mongoose.Types.ObjectId(classId), rollNumber }
            },
            upsert: true
        }
    }));
    await StudentRecord.bulkWrite(upsertOps, { session });

    // Phase 2: Pull old dayLog entry for this date from all students
    await StudentRecord.bulkWrite(
        rollNumbers.map(rollNumber => ({
            updateOne: {
                filter: { classId: new mongoose.Types.ObjectId(classId), rollNumber },
                update: { $pull: { dayLog: { date: searchDate } } }
            }
        })),
        { session }
    );

    // Phase 3: Push new dayLog entry (only if there are periods to record)
    if (periodsToSync.length > 0) {
        const pushOps = rollNumbers.map(rollNumber => {
            const dayLogEntry = {
                date: searchDate,
                periods: periodsToSync.map(p => ({
                    periodNum: p.periodNum,
                    subjectId: p.subjectId,
                    subjectName: p.subjectName,
                    // Use getPeriodStatus so DL is correctly written into StudentRecord
                    status: getPeriodStatus(p, rollNumber)
                }))
            };
            return {
                updateOne: {
                    filter: { classId: new mongoose.Types.ObjectId(classId), rollNumber },
                    update: { $push: { dayLog: dayLogEntry } }
                }
            };
        });
        await StudentRecord.bulkWrite(pushOps, { session });
    }

    // Phase 4: Recompute subject stats from the full dayLog for each student
    const studentRecords = await StudentRecord.find(
        { classId: new mongoose.Types.ObjectId(classId), rollNumber: { $in: rollNumbers } }
    ).session(session).lean();

    const statOps = studentRecords.map(record => {
        const statsAccum = {};

        (record.dayLog || []).forEach(day => {
            (day.periods || []).forEach(p => {
                if (!p.subjectId) return;
                if (!statsAccum[p.subjectId]) {
                    statsAccum[p.subjectId] = {
                        subjectId: p.subjectId,
                        subjectName: p.subjectName || subjectMap[p.subjectId] || '',
                        totalClasses: 0,
                        attendedClasses: 0
                    };
                }
                statsAccum[p.subjectId].totalClasses += 1;
                // Both 'Present' and 'Present (DL)' count as attended
                if (p.status === 'Present' || p.status === 'Present (DL)') {
                    statsAccum[p.subjectId].attendedClasses += 1;
                }
            });
        });

        return {
            updateOne: {
                filter: { _id: record._id },
                update: { $set: { subjects: Object.values(statsAccum) } }
            }
        };
    });

    if (statOps.length > 0) {
        await StudentRecord.bulkWrite(statOps, { session });
    }
};

// @route   POST /api/attendance/mark
router.post('/mark', auth, async (req, res) => {
    const session = await mongoose.startSession();

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

        session.startTransaction();

        let updatedRecord;
        if (normalizedPeriods.length === 0) {
            await Attendance.findOneAndDelete(
                { classId: classId, date: searchDate },
                { session }
            );
            updatedRecord = null;
        } else {
            // Preserve existing DL rolls when re-marking attendance
            const existing = await Attendance.findOne({ classId, date: searchDate }).lean();
            const existingDLMap = {};
            if (existing) {
                existing.periods.forEach(p => {
                    existingDLMap[p.periodNum] = deduplicateRolls(p.dutyLeaveRollNumbers || []);
                });
            }

            // FIX: was saving normalizedPeriods — must save mergedPeriods to preserve DL
            const mergedPeriods = normalizedPeriods.map(p => ({
                ...p,
                dutyLeaveRollNumbers: p.dutyLeaveRollNumbers?.length
                    ? p.dutyLeaveRollNumbers
                    : (existingDLMap[p.periodNum] || [])
            }));

            updatedRecord = await Attendance.findOneAndUpdate(
                { classId: classId, date: searchDate },
                { $set: { periods: mergedPeriods } },  // FIX: mergedPeriods not normalizedPeriods
                { new: true, upsert: true, session }
            );

            // Sync using mergedPeriods so DL is included in StudentRecord
            await syncStudentRecords(classId, searchDate, mergedPeriods, session);
        }

        if (normalizedPeriods.length === 0) {
            // Attendance deleted — wipe dayLog entries for this date
            await syncStudentRecords(classId, searchDate, [], session);
        }

        await session.commitTransaction();

        res.json({ message: 'Attendance Saved Successfully!', data: updatedRecord });

        /*
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
        */

    } catch (err) {
        if (session.inTransaction()) await session.abortTransaction();
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    } finally {
        session.endSession();
    }
});

// @route   GET /api/attendance/by-date/:classId/:date
router.get('/by-date/:classId/:date', async (req, res) => {
    try {
        const { classId, date } = req.params;
        const searchDate = normalizeDate(date);
        const record = await Attendance.findOne({ classId, date: searchDate }).lean();
        if (!record) return res.json({ periods: [] });
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
        res.json({ dates: records.map(r => r.date) });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   POST /api/attendance/duty-leave
// @desc    Toggle DL for selected rolls on selected periods for a date.
//          Also syncs StudentRecord so the change is immediately reflected for students.
// @access  Admin only
router.post('/duty-leave', auth, async (req, res) => {
    const session = await mongoose.startSession();

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

        const record = await Attendance.findOne({ classId, date: searchDate });
        if (!record) {
            return res.status(404).json({
                error: 'No attendance record found for this date. Mark attendance first.'
            });
        }

        // Toggle logic: if ALL selected rolls are already DL on ALL selected periods → remove
        const targetPeriods = record.periods.filter(p => periodNums.includes(p.periodNum));
        const allAlreadyDL = cleanRolls.every(roll =>
            targetPeriods.every(p =>
                deduplicateRolls(p.dutyLeaveRollNumbers || []).includes(roll)
            )
        );

        record.periods = record.periods.map(period => {
            if (!periodNums.includes(period.periodNum)) return period;

            let dlRolls = deduplicateRolls(period.dutyLeaveRollNumbers || []);
            if (allAlreadyDL) {
                dlRolls = dlRolls.filter(r => !cleanRolls.includes(r));
            } else {
                cleanRolls.forEach(roll => {
                    if (!dlRolls.includes(roll)) dlRolls.push(roll);
                });
            }
            period.dutyLeaveRollNumbers = dlRolls;
            return period;
        });

        record.markModified('periods');

        session.startTransaction();

        await record.save({ session });

        // FIX: sync StudentRecord after DL change so students see updated status immediately
        await syncStudentRecords(classId, searchDate, record.periods, session);

        await session.commitTransaction();

        const action = allAlreadyDL ? 'removed' : 'applied';
        res.json({
            message: `Duty Leave ${action} successfully`,
            action,
            data: record
        });

    } catch (err) {
        if (session.inTransaction()) await session.abortTransaction();
        console.error('Duty Leave Error:', err);
        res.status(500).json({ error: 'Server Error' });
    } finally {
        session.endSession();
    }
});

module.exports = router;