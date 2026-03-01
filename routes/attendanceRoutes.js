const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Classroom = require('../models/Classroom');
const Student = require('../models/Student');
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

// ═════════════════════════════════════════════════════════════════════════════
//  Denormalized Summary Sync
//  Updates each Student's `summary` Map when attendance is saved/updated/deleted.
//
//  Strategy: Diff the OLD periods vs NEW periods for the same date.
//  - For removed periods: reverse their counts
//  - For added periods:   apply new counts
//  - For changed periods: reverse old, apply new
//
//  Uses bulkWrite with $inc for atomicity and performance at 1000+ students.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Build a per-student, per-subject delta map from a set of periods.
 * Returns: Map<rollNumber, Map<subjectId, { dTotal, dAttended }>>
 *
 * @param {Array} periods       - The periods array
 * @param {Set}   allRollNumbers - All roll numbers in the class
 * @param {number} sign          - +1 (apply) or -1 (reverse)
 */
const buildDeltaMap = (periods, allRollNumbers, sign) => {
    // subjectId → Set of absent rolls
    const subjectAbsent = new Map();

    for (const period of periods) {
        const sid = String(period.subjectId);
        if (!subjectAbsent.has(sid)) {
            subjectAbsent.set(sid, new Set());
        }
        const absentSet = subjectAbsent.get(sid);
        for (const roll of (period.absentRollNumbers || [])) {
            absentSet.add(roll);
        }
    }

    // Build per-student deltas
    // Map<rollNumber, Map<subjectId, { dTotal, dAttended }>>
    const deltas = new Map();

    for (const roll of allRollNumbers) {
        const studentDeltas = new Map();

        for (const [sid, absentSet] of subjectAbsent) {
            const isAbsent = absentSet.has(roll);
            studentDeltas.set(sid, {
                dTotal: sign * 1,
                dAttended: isAbsent ? 0 : sign * 1
            });
        }

        deltas.set(roll, studentDeltas);
    }

    return deltas;
};

/**
 * Merge two delta maps (reverse old + apply new).
 */
const mergeDeltaMaps = (oldDeltas, newDeltas, allRolls) => {
    const merged = new Map();

    for (const roll of allRolls) {
        const oldMap = oldDeltas.get(roll) || new Map();
        const newMap = newDeltas.get(roll) || new Map();
        const mergedMap = new Map();

        // Collect all subject IDs
        const allSids = new Set([...oldMap.keys(), ...newMap.keys()]);

        for (const sid of allSids) {
            const old = oldMap.get(sid) || { dTotal: 0, dAttended: 0 };
            const nw = newMap.get(sid) || { dTotal: 0, dAttended: 0 };

            const dTotal = old.dTotal + nw.dTotal;
            const dAttended = old.dAttended + nw.dAttended;

            // Skip no-ops
            if (dTotal !== 0 || dAttended !== 0) {
                mergedMap.set(sid, { dTotal, dAttended });
            }
        }

        if (mergedMap.size > 0) {
            merged.set(roll, mergedMap);
        }
    }

    return merged;
};

/**
 * Apply a merged delta map to Student documents using bulkWrite.
 * Each student gets one updateOne op with $inc on their summary map.
 */
const applySummaryDeltas = async (classId, mergedDeltas) => {
    if (mergedDeltas.size === 0) return;

    const ops = [];

    for (const [roll, subjectDeltas] of mergedDeltas) {
        const incFields = {};

        for (const [sid, { dTotal, dAttended }] of subjectDeltas) {
            if (dTotal !== 0) incFields[`summary.${sid}.total`] = dTotal;
            if (dAttended !== 0) incFields[`summary.${sid}.attended`] = dAttended;
        }

        if (Object.keys(incFields).length > 0) {
            ops.push({
                updateOne: {
                    filter: { classId, rollNumber: roll },
                    update: { $inc: incFields }
                }
            });
        }
    }

    if (ops.length > 0) {
        await Student.bulkWrite(ops, { ordered: false });
    }
};

/**
 * Sync student summaries after an attendance change.
 *
 * @param {string} classId
 * @param {Array|null} oldPeriods - Previous periods (null if new record)
 * @param {Array|null} newPeriods - New periods (null if deleted)
 */
const syncStudentSummaries = async (classId, oldPeriods, newPeriods) => {
    // Get all roll numbers for this class
    const students = await Student.find({ classId }).select('rollNumber').lean();
    if (students.length === 0) return;

    const allRolls = new Set(students.map(s => s.rollNumber));

    let mergedDeltas;

    if (!oldPeriods && newPeriods) {
        // Case 1: New record — apply new counts
        mergedDeltas = buildDeltaMap(newPeriods, allRolls, +1);
    } else if (oldPeriods && !newPeriods) {
        // Case 2: Deleted record — reverse old counts
        mergedDeltas = buildDeltaMap(oldPeriods, allRolls, -1);
    } else if (oldPeriods && newPeriods) {
        // Case 3: Updated record — reverse old, apply new
        const oldDeltas = buildDeltaMap(oldPeriods, allRolls, -1);
        const newDeltasMap = buildDeltaMap(newPeriods, allRolls, +1);
        mergedDeltas = mergeDeltaMaps(oldDeltas, newDeltasMap, allRolls);
    } else {
        return; // both null — no-op
    }

    await applySummaryDeltas(classId, mergedDeltas);
};

// ═════════════════════════════════════════════════════════════════════════════
//  Routes
// ═════════════════════════════════════════════════════════════════════════════

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

        // Fetch the existing record BEFORE updating (for delta calculation)
        const existingRecord = await Attendance.findOne({ classId, date: searchDate })
            .select('periods')
            .lean();

        const oldPeriods = existingRecord?.periods || null;

        let updatedRecord;
        if (normalizedPeriods.length === 0) {
            // Delete the entire attendance document if there are no periods
            await Attendance.findOneAndDelete({ classId, date: searchDate });
            updatedRecord = null;
        } else {
            updatedRecord = await Attendance.findOneAndUpdate(
                { classId, date: searchDate },
                { $set: { periods: normalizedPeriods } },
                { new: true, upsert: true }
            );
        }

        // Respond immediately, sync summaries in the background (non-blocking)
        res.json({ message: 'Attendance Saved Successfully!', data: updatedRecord });

        // ── Denormalized summary sync (fire-and-forget) ──
        const newPeriods = normalizedPeriods.length > 0 ? normalizedPeriods : null;
        syncStudentSummaries(classId, oldPeriods, newPeriods).catch(err => {
            console.error('Summary sync error:', err);
        });

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

module.exports = router;
