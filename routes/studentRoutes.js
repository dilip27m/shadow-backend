const express = require('express');
const router = express.Router();
const mongoose = require('mongoose'); // Required for ObjectId casting
const Classroom = require('../models/Classroom');
const Attendance = require('../models/Attendance');

// Get overall attendance report
router.get('/report/:classId/:rollNumber', async (req, res) => {
    try {
        const { classId, rollNumber } = req.params;
        const rollNo = parseInt(rollNumber);

        if (!mongoose.Types.ObjectId.isValid(classId)) {
            return res.status(400).json({ error: 'Invalid Class ID' });
        }

        const classroom = await Classroom.findById(classId);
        if (!classroom) return res.status(404).json({ error: 'Class not found' });

        // 🚀 OPTIMIZATION: Use Aggregation instead of fetching all records
        const latestAttendance = await Attendance.findOne({ classId }).sort({ updatedAt: -1 }).select('updatedAt');
        const lastUpdated = latestAttendance ? latestAttendance.updatedAt : null;

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
                            $cond: [{ $in: [rollNo, "$periods.absentRollNumbers"] }, 0, 1]
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
        const rollNo = parseInt(rollNumber);

        // Normalize date to match how it's stored (same as attendance save)
        const normalizeDate = (dateString) => {
            const datePart = new Date(dateString).toISOString().split('T')[0];
            return new Date(`${datePart}T00:00:00.000Z`);
        };

        const queryDate = normalizeDate(date);



        // Find the most recent attendance record for this date
        const attendanceRecord = await Attendance.findOne({
            classId,
            date: queryDate
        }).sort({ updatedAt: -1 });



        // Only return data if attendance was actually marked
        if (!attendanceRecord || !attendanceRecord.periods || attendanceRecord.periods.length === 0) {
            return res.json({ periods: [] });
        }

        const periodsWithStatus = attendanceRecord.periods.map(period => {
            const isAbsent = period.absentRollNumbers.includes(rollNo);
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
        const rollNo = parseInt(rollNumber);

        // Find all attendance records containing this subject
        // Sort by date descending (newest first)
        const records = await Attendance.find({
            classId: classId,
            'periods.subjectId': subjectId
        }).select('date periods').sort({ date: -1 });

        const history = [];

        records.forEach(record => {
            // A subject might occur multiple times in one day (e.g. 2 periods)
            const relevantPeriods = record.periods.filter(p => String(p.subjectId) === String(subjectId));

            relevantPeriods.forEach(p => {
                history.push({
                    date: record.date, // Frontend will format this
                    status: p.absentRollNumbers.includes(rollNo) ? 'Absent' : 'Present',
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