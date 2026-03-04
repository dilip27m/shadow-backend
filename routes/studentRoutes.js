const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
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

const isRollOnDutyLeave = (dutyLeaveRollNumbers, rollNumber) => {
    if (!Array.isArray(dutyLeaveRollNumbers)) return false;
    return dutyLeaveRollNumbers.some((roll) => sanitizeRollNumber(roll) === rollNumber);
};

// Derive the display status and whether the period counts as attended
const getPeriodStatus = (period, rollNo) => {
    const absent = isRollAbsent(period.absentRollNumbers, rollNo);
    const dl = isRollOnDutyLeave(period.dutyLeaveRollNumbers, rollNo);

    if (!absent) return { status: 'Present', attended: true };
    if (dl) return { status: 'Present (DL)', attended: true };  // absent but DL overrides to present
    return { status: 'Absent', attended: false };
};

// Issue student access token
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

// Get overall attendance report — DL counts as present
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
            .select('className subjects rollNumbers totalStudents blockedRollNumbers').lean();
        if (!classroom) return res.status(404).json({ error: 'Class not found' });

        const classRollNumbers = getClassRollNumbers(classroom);
        if (!classRollNumbers.includes(rollNo)) {
            return res.status(404).json({ error: 'Student not found' });
        }

        const blockedRolls = (classroom.blockedRollNumbers || []).map(r => sanitizeRollNumber(r)).filter(Boolean);
        if (blockedRolls.includes(rollNo)) {
            return res.status(403).json({ error: 'This roll number\'s attendance is set to private by the class admin.' });
        }

        const latestAttendance = await Attendance.findOne({ classId })
            .sort({ updatedAt: -1 }).select('updatedAt').lean();
        const lastUpdated = latestAttendance ? latestAttendance.updatedAt : null;

        // Build absent checks (handle both string and numeric roll stored in DB)
        const absentChecks = [{ $in: [rollNo, '$periods.absentRollNumbers'] }];
        if (/^\d+$/.test(rollNo)) {
            absentChecks.push({ $in: [Number(rollNo), '$periods.absentRollNumbers'] });
        }

        // Build DL checks (same pattern)
        const dlChecks = [{ $in: [rollNo, '$periods.dutyLeaveRollNumbers'] }];
        if (/^\d+$/.test(rollNo)) {
            dlChecks.push({ $in: [Number(rollNo), '$periods.dutyLeaveRollNumbers'] });
        }

        const stats = await Attendance.aggregate([
            { $match: { classId: new mongoose.Types.ObjectId(classId) } },
            { $unwind: '$periods' },
            {
                $group: {
                    _id: '$periods.subjectId',
                    totalClasses: { $sum: 1 },
                    attendedClasses: {
                        $sum: {
                            $cond: {
                                if: { $or: absentChecks },
                                then: {
                                    // Absent — but check if DL overrides it to present
                                    $cond: [{ $or: dlChecks }, 1, 0]
                                },
                                else: 1  // Not absent → present
                            }
                        }
                    }
                }
            }
        ]);

        const statsMap = {};
        stats.forEach(stat => {
            statsMap[stat._id] = stat;
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
        console.error('Report Error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Day attendance — returns Present / Present (DL) / Absent
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

        const normalizeDate = (dateString) => {
            const datePart = new Date(dateString).toISOString().split('T')[0];
            return new Date(`${datePart}T00:00:00.000Z`);
        };

        const queryDate = normalizeDate(date);
        const attendanceRecord = await Attendance.findOne({ classId, date: queryDate })
            .sort({ updatedAt: -1 }).select('periods').lean();

        if (!attendanceRecord || !attendanceRecord.periods || attendanceRecord.periods.length === 0) {
            return res.json({ periods: [] });
        }

        const periodsWithStatus = attendanceRecord.periods.map(period => {
            const { status } = getPeriodStatus(period, rollNo);
            return {
                periodNum: period.periodNum,
                subjectName: period.subjectName,
                status
            };
        });

        res.json({ periods: periodsWithStatus });
    } catch (err) {
        console.error('Error in day-attendance:', err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Subject history — returns Present / Present (DL) / Absent per period
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

        const records = await Attendance.find({
            classId: classId,
            'periods.subjectId': subjectId
        }).select('date periods').sort({ date: -1 }).lean();

        const history = [];

        records.forEach(record => {
            const relevantPeriods = record.periods.filter(p => String(p.subjectId) === String(subjectId));

            relevantPeriods.forEach(p => {
                const { status } = getPeriodStatus(p, rollNo);
                history.push({
                    date: record.date,
                    status,
                    periodNum: p.periodNum
                });
            });
        });

        res.json({ history });

    } catch (err) {
        console.error('History Error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;