const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Classroom = require('../models/Classroom');
const StudentRecord = require('../models/StudentRecord');

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

    // Legacy fallback for old class documents that only have totalStudents.
    const totalStudents = Number(classroom?.totalStudents);
    if (Number.isInteger(totalStudents) && totalStudents > 0) {
        return Array.from({ length: totalStudents }, (_, index) => String(index + 1));
    }

    return [];
};

// Issue student access token after validating class + roll membership
router.post('/access', async (req, res) => {
    try {
        const className = String(req.body?.className || '').trim();
        const rollNumber = sanitizeRollNumber(req.body?.rollNumber);

        if (!className || !rollNumber) {
            return res.status(400).json({ error: 'className and rollNumber are required' });
        }

        const classroom = await Classroom.findOne({ className })
            .collation({ locale: 'en', strength: 2 })
            .select('_id className rollNumbers totalStudents blockedRollNumbers')
            .lean();

        if (!classroom) {
            return res.status(404).json({ error: 'Class not found' });
        }

        const classRollNumbers = getClassRollNumbers(classroom);
        if (!classRollNumbers.includes(rollNumber)) {
            return res.status(404).json({ error: 'Student not found' });
        }

        // Check if the student is blocked (privacy opt-out)
        const blockedRolls = (classroom.blockedRollNumbers || []).map(r => sanitizeRollNumber(r)).filter(Boolean);
        if (blockedRolls.includes(rollNumber)) {
            return res.status(403).json({ error: 'This roll number\'s attendance is set to private by the class admin.' });
        }

        const token = jwt.sign(
            { classId: classroom._id.toString(), rollNumber, role: 'student' },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            classId: classroom._id,
            className: classroom.className,
            rollNumber,
            token
        });
    } catch (err) {
        console.error('Student access error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Get overall attendance report — O(1) lookup from StudentRecord
router.get('/report/:classId/:rollNumber', async (req, res) => {
    try {
        const { classId, rollNumber } = req.params;
        const rollNo = sanitizeRollNumber(rollNumber);

        if (!mongoose.Types.ObjectId.isValid(classId)) {
            return res.status(400).json({ error: 'Invalid Class ID' });
        }

        if (rollNo === null) {
            return res.status(400).json({ error: 'Invalid Roll Number' });
        }

        const classroom = await Classroom.findById(classId)
            .select('className subjects rollNumbers totalStudents blockedRollNumbers')
            .lean();
        if (!classroom) return res.status(404).json({ error: 'Class not found' });

        const classRollNumbers = getClassRollNumbers(classroom);
        if (!classRollNumbers.includes(rollNo)) {
            return res.status(404).json({ error: 'Student not found' });
        }

        // Check if the student is blocked (privacy opt-out)
        const blockedRolls = (classroom.blockedRollNumbers || []).map(r => sanitizeRollNumber(r)).filter(Boolean);
        if (blockedRolls.includes(rollNo)) {
            return res.status(403).json({ error: 'This roll number\'s attendance is set to private by the class admin.' });
        }

        // O(1) lookup — single document per student
        const studentRecord = await StudentRecord.findOne({
            classId: new mongoose.Types.ObjectId(classId),
            rollNumber: rollNo
        }).lean();

        const lastUpdated = studentRecord?.lastSyncedAt || null;

        // Build report from pre-computed subjects in StudentRecord
        const statsMap = {};
        (studentRecord?.subjects || []).forEach(stat => {
            statsMap[stat.subjectId] = stat;
        });

        const finalReport = classroom.subjects.map(subject => {
            const stat = statsMap[subject._id.toString()] || { totalClasses: 0, attendedClasses: 0 };
            const { totalClasses, attendedClasses } = stat;
            const percentage = totalClasses === 0 ? 0 : parseFloat(((attendedClasses / totalClasses) * 100).toFixed(1));

            return {
                _id: subject._id,
                subjectName: subject.name,
                code: subject.code,
                percentage,
                attended: attendedClasses,
                total: totalClasses
            };
        });

        res.json({
            studentRoll: rollNo,
            className: classroom.className,
            lastUpdated,
            subjects: finalReport
        });

    } catch (err) {
        console.error("Report Error:", err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Get day-level attendance — read from StudentRecord dayLog
router.get('/day-attendance/:classId/:rollNumber/:date', async (req, res) => {
    try {
        const { classId, rollNumber, date } = req.params;
        const rollNo = sanitizeRollNumber(rollNumber);

        if (!mongoose.Types.ObjectId.isValid(classId)) {
            return res.status(400).json({ error: 'Invalid Class ID' });
        }

        if (rollNo === null) {
            return res.status(400).json({ error: 'Invalid Roll Number' });
        }

        const classroom = await Classroom.findById(classId).select('rollNumbers totalStudents').lean();
        if (!classroom) return res.status(404).json({ error: 'Class not found' });

        const classRollNumbers = getClassRollNumbers(classroom);
        if (!classRollNumbers.includes(rollNo)) {
            return res.status(404).json({ error: 'Student not found' });
        }

        // Normalize date
        const datePart = new Date(date).toISOString().split('T')[0];
        const queryDate = new Date(`${datePart}T00:00:00.000Z`);

        // O(1) lookup
        const studentRecord = await StudentRecord.findOne({
            classId: new mongoose.Types.ObjectId(classId),
            rollNumber: rollNo
        }).lean();

        if (!studentRecord) {
            return res.json({ periods: [] });
        }

        // Find the dayLog entry for the requested date
        const dayEntry = (studentRecord.dayLog || []).find(d => {
            const dDate = new Date(d.date).toISOString().split('T')[0];
            return dDate === datePart;
        });

        if (!dayEntry || !dayEntry.periods || dayEntry.periods.length === 0) {
            return res.json({ periods: [] });
        }

        const periodsWithStatus = dayEntry.periods.map(p => ({
            periodNum: p.periodNum,
            subjectName: p.subjectName,
            status: p.status
        }));

        res.json({ periods: periodsWithStatus });
    } catch (err) {
        console.error('Error in day-attendance:', err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Get detailed history for a specific subject — read from StudentRecord dayLog
router.get('/history/:classId/:rollNumber/:subjectId', async (req, res) => {
    try {
        const { classId, rollNumber, subjectId } = req.params;
        const rollNo = sanitizeRollNumber(rollNumber);

        if (!mongoose.Types.ObjectId.isValid(classId)) {
            return res.status(400).json({ error: 'Invalid Class ID' });
        }

        if (rollNo === null) {
            return res.status(400).json({ error: 'Invalid Roll Number' });
        }

        const classroom = await Classroom.findById(classId).select('rollNumbers totalStudents').lean();
        if (!classroom) return res.status(404).json({ error: 'Class not found' });

        const classRollNumbers = getClassRollNumbers(classroom);
        if (!classRollNumbers.includes(rollNo)) {
            return res.status(404).json({ error: 'Student not found' });
        }

        // O(1) lookup
        const studentRecord = await StudentRecord.findOne({
            classId: new mongoose.Types.ObjectId(classId),
            rollNumber: rollNo
        }).lean();

        if (!studentRecord) {
            return res.json({ history: [] });
        }

        // Filter dayLog entries that contain the requested subject
        const history = [];

        // Sort dayLog by date descending (newest first)
        const sortedDayLog = (studentRecord.dayLog || [])
            .slice()
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        sortedDayLog.forEach(day => {
            const relevantPeriods = (day.periods || []).filter(
                p => String(p.subjectId) === String(subjectId)
            );

            relevantPeriods.forEach(p => {
                history.push({
                    date: day.date,
                    status: p.status,
                    periodNum: p.periodNum
                });
            });
        });

        res.json({ history });

    } catch (err) {
        console.error("History Error:", err);
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;

