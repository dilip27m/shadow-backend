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

/**
 * Sync StudentRecord documents for all students in a class for a given date.
 * Recomputes the dayLog entry and subject-level stats from ALL attendance data.
 * Runs inside the provided session for transactional atomicity.
 */
const syncStudentRecords = async (classId, searchDate, normalizedPeriods, session) => {
    // Get class roll numbers
    const classroom = await Classroom.findById(classId)
        .select('rollNumbers subjects')
        .session(session)
        .lean();

    if (!classroom || !Array.isArray(classroom.rollNumbers)) return;

    const rollNumbers = classroom.rollNumbers
        .map(r => sanitizeRollNumber(r))
        .filter(Boolean);

    if (rollNumbers.length === 0) return;

    // Build absent sets for fast lookup per period
    const absentSets = normalizedPeriods.map(p => new Set(p.absentRollNumbers || []));

    // Build the dayLog entry and per-subject deltas for each student
    const bulkOps = rollNumbers.map(rollNumber => {
        // Compute this student's dayLog entry for this date
        const dayLogEntry = {
            date: searchDate,
            periods: normalizedPeriods.map((p, i) => ({
                periodNum: p.periodNum,
                subjectId: p.subjectId,
                subjectName: p.subjectName,
                status: absentSets[i].has(rollNumber) ? 'Absent' : 'Present'
            }))
        };

        return {
            rollNumber,
            dayLogEntry
        };
    });

    // For each student, we need to:
    // 1. Remove the old dayLog entry for this date (if editing)
    // 2. Add the new dayLog entry
    // 3. Recompute subject stats from ALL attendance records
    //
    // Strategy: Pull old date entry, push new one, then recompute stats.
    // We do this in two phases for efficiency.

    // Phase 1: Upsert each student record and update the dayLog for this date
    const writeOps = bulkOps.map(({ rollNumber, dayLogEntry }) => ({
        updateOne: {
            filter: { classId: new mongoose.Types.ObjectId(classId), rollNumber },
            update: {
                $set: { lastSyncedAt: new Date() },
                $setOnInsert: { classId: new mongoose.Types.ObjectId(classId), rollNumber }
            },
            upsert: true
        }
    }));

    if (writeOps.length > 0) {
        await StudentRecord.bulkWrite(writeOps, { session });
    }

    // Phase 2: For each student, pull old dayLog entry for this date then push new one,
    //          and recompute subject stats
    const updateOps = [];

    for (const { rollNumber, dayLogEntry } of bulkOps) {
        // Pull old entry for this date
        updateOps.push({
            updateOne: {
                filter: { classId: new mongoose.Types.ObjectId(classId), rollNumber },
                update: { $pull: { dayLog: { date: searchDate } } }
            }
        });
    }

    if (updateOps.length > 0) {
        await StudentRecord.bulkWrite(updateOps, { session });
    }

    // Push new dayLog entries (only if there are periods to record)
    if (normalizedPeriods.length > 0) {
        const pushOps = bulkOps.map(({ rollNumber, dayLogEntry }) => ({
            updateOne: {
                filter: { classId: new mongoose.Types.ObjectId(classId), rollNumber },
                update: { $push: { dayLog: dayLogEntry } }
            }
        }));

        if (pushOps.length > 0) {
            await StudentRecord.bulkWrite(pushOps, { session });
        }
    }

    // Phase 3: Recompute subject stats for all students from their dayLog
    // Use aggregation on StudentRecord itself (fast, already per-student)
    const studentRecords = await StudentRecord.find(
        { classId: new mongoose.Types.ObjectId(classId), rollNumber: { $in: rollNumbers } }
    ).session(session).lean();

    const subjectMap = {};
    (classroom.subjects || []).forEach(s => {
        subjectMap[s._id.toString()] = s.name;
    });

    const statOps = studentRecords.map(record => {
        // Recompute subjects from dayLog
        const statsAccum = {}; // subjectId -> { total, attended }

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
                if (p.status === 'Present') {
                    statsAccum[p.subjectId].attendedClasses += 1;
                }
            });
        });

        const subjects = Object.values(statsAccum);

        return {
            updateOne: {
                filter: { _id: record._id },
                update: { $set: { subjects } }
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

        // Start transaction — both Attendance and StudentRecord update atomically
        session.startTransaction();

        let updatedRecord;
        if (normalizedPeriods.length === 0) {
            await Attendance.findOneAndDelete(
                { classId: classId, date: searchDate },
                { session }
            );
            updatedRecord = null;
        } else {
            updatedRecord = await Attendance.findOneAndUpdate(
                { classId: classId, date: searchDate },
                { $set: { periods: normalizedPeriods } },
                { new: true, upsert: true, session }
            );
        }

        // Sync StudentRecords within the same transaction
        await syncStudentRecords(classId, searchDate, normalizedPeriods, session);

        // Both succeeded — commit
        await session.commitTransaction();

        res.json({ message: 'Attendance Saved Successfully!', data: updatedRecord });

    } catch (err) {
        // Rollback on any failure
        if (session.inTransaction()) {
            await session.abortTransaction();
        }
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    } finally {
        session.endSession();
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
