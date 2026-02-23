const express = require('express');
const router = express.Router();
const mongoose = require('mongoose'); // Required for ObjectId casting
const jwt = require('jsonwebtoken');
const Classroom = require('../models/Classroom');
const Attendance = require('../models/Attendance');

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

const isRollAbsent = (absentRollNumbers, rollNumber) => {
    if (!Array.isArray(absentRollNumbers)) return false;
    return absentRollNumbers.some((roll) => sanitizeRollNumber(roll) === rollNumber);
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

// Get overall attendance report
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

        const classroom = await Classroom.findById(classId).select('className subjects rollNumbers totalStudents blockedRollNumbers').lean();
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

        // 🚀 OPTIMIZATION: Use Aggregation instead of fetching all records
        const latestAttendance = await Attendance.findOne({ classId }).sort({ updatedAt: -1 }).select('updatedAt').lean();
        const lastUpdated = latestAttendance ? latestAttendance.updatedAt : null;

        const absentChecks = [{ $in: [rollNo, "$periods.absentRollNumbers"] }];
        if (/^\d+$/.test(rollNo)) {
            absentChecks.push({ $in: [Number(rollNo), "$periods.absentRollNumbers"] });
        }

        const stats = await Attendance.aggregate([
            {
                $match: { classId: new mongoose.Types.ObjectId(classId) }
            },
            {
                $unwind: "$periods"
            },
            {
                $group: {
                    _id: "$periods.subjectId", // Group by Subject ID
                    totalClasses: { $sum: 1 },
                    attendedClasses: {
                        $sum: {
                            // If rollNo is in absent list, add 0, else add 1
                            $cond: [{ $or: absentChecks }, 0, 1]
                        }
                    }
                }
            }
        ]);

        // Convert array to Map for O(1) lookup
        const statsMap = {};
        stats.forEach(stat => {
            statsMap[stat._id] = stat;
        });

        // Finalize calculations using Classroom metadata
        const finalReport = classroom.subjects.map(subject => {
            // Get stats from map or default to 0
            const stat = statsMap[subject._id.toString()] || { totalClasses: 0, attendedClasses: 0 };
            const { totalClasses, attendedClasses } = stat;

            const percentage = totalClasses === 0 ? 0 : parseFloat(((attendedClasses / totalClasses) * 100).toFixed(1));

            return {
                _id: subject._id,
                subjectName: subject.name, // Frontend expects 'subjectName'
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

        // Normalize date to match how it's stored (same as attendance save)
        const normalizeDate = (dateString) => {
            const datePart = new Date(dateString).toISOString().split('T')[0];
            return new Date(`${datePart}T00:00:00.000Z`);
        };

        const queryDate = normalizeDate(date);



        // Find the most recent attendance record for this date
        const attendanceRecord = await Attendance.findOne({ classId, date: queryDate }).sort({ updatedAt: -1 }).select('periods').lean();



        // Only return data if attendance was actually marked
        if (!attendanceRecord || !attendanceRecord.periods || attendanceRecord.periods.length === 0) {
            return res.json({ periods: [] });
        }

        const periodsWithStatus = attendanceRecord.periods.map(period => {
            const isAbsent = isRollAbsent(period.absentRollNumbers, rollNo);
            return {
                periodNum: period.periodNum,
                subjectName: period.subjectName,
                status: isAbsent ? 'Absent' : 'Present'
            };
        });

        res.json({ periods: periodsWithStatus });
    } catch (err) {
        console.error('Error in day-attendance:', err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Get detailed history for a specific subject
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

        // Find all attendance records containing this subject
        // Sort by date descending (newest first)
        const records = await Attendance.find({
            classId: classId,
            'periods.subjectId': subjectId
        }).select('date periods').sort({ date: -1 }).lean();

        const history = [];

        records.forEach(record => {
            // A subject might occur multiple times in one day (e.g. 2 periods)
            const relevantPeriods = record.periods.filter(p => String(p.subjectId) === String(subjectId));

            relevantPeriods.forEach(p => {
                history.push({
                    date: record.date, // Frontend will format this
                    status: isRollAbsent(p.absentRollNumbers, rollNo) ? 'Absent' : 'Present',
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
