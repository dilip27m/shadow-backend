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

            const percentage = totalClasses === 0 ? 0 : ((attendedClasses / totalClasses) * 100).toFixed(1);
            const floatPercentage = parseFloat(percentage);

            let bunkMsg = "";
            const minPercentage = classroom.settings?.minAttendancePercentage || 75;

            if (floatPercentage >= minPercentage + 5) { // Safe buffer
                const canBunk = Math.floor((attendedClasses / (minPercentage / 100)) - totalClasses);
                bunkMsg = `Safe! You can bunk ${Math.max(0, canBunk)} more classes.`;
            } else if (floatPercentage < minPercentage) {
                const mustAttend = Math.ceil(((minPercentage / 100) * totalClasses - attendedClasses) / (1 - (minPercentage / 100)));
                bunkMsg = `Danger! Attend next ${Math.max(1, mustAttend)} classes to recover.`;
            } else {
                bunkMsg = "Borderline! Be careful.";
            }

            return {
                ...subject.toObject(), // Ensure we keep original subject properties
                percentage: floatPercentage,
                attended: attendedClasses,
                total: totalClasses,
                message: bunkMsg
            };
        });

        res.json({
            studentRoll: rollNo,
            className: classroom.className,
            subjects: finalReport
        });

    } catch (err) {
        console.error("Report Error:", err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Simulate bunk impact
router.post('/simulate-bunk', async (req, res) => {
    try {
        const { classId, rollNumber, dates } = req.body;
        const rollNo = parseInt(rollNumber);

        const classroom = await Classroom.findById(classId);
        if (!classroom) return res.status(404).json({ error: 'Class not found' });

        // NOTE: For consistency, you should also apply aggregation here if this endpoint gets slow,
        // but since we need granular control for simulation, we'll keep logic similar but ensure we optimize queries later if needed.
        // For now, the bottleneck is primarily on the main dashboard load.

        const allRecords = await Attendance.find({ classId });

        // 1. Calculate Current Status (Standard Loop - could be replaced by aggregation for speed)
        let currentStats = {};
        classroom.subjects.forEach(sub => {
            currentStats[sub._id.toString()] = {
                subjectName: sub.name,
                totalClasses: 0,
                attendedClasses: 0
            };
        });

        allRecords.forEach(day => {
            day.periods.forEach(p => {
                const subId = p.subjectId.toString();
                if (currentStats[subId]) {
                    currentStats[subId].totalClasses += 1;
                    if (!p.absentRollNumbers.includes(rollNo)) {
                        currentStats[subId].attendedClasses += 1;
                    }
                }
            });
        });

        // 2. Calculate Impact
        const impacts = [];
        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

        for (const [subjectId, stat] of Object.entries(currentStats)) {

            let classesOnSelectedDates = 0;

            dates.forEach(date => {
                const d = new Date(date);
                const dayOfWeek = days[d.getDay()];
                const daySchedule = classroom.timetable?.[dayOfWeek] || [];

                const hasClass = daySchedule.some(slot => String(slot.subjectId) === String(subjectId));

                if (hasClass) classesOnSelectedDates++;
            });

            const currentPercentage = stat.totalClasses === 0
                ? 100
                : (stat.attendedClasses / stat.totalClasses) * 100;

            const afterTotal = stat.totalClasses + classesOnSelectedDates;
            const afterAttended = stat.attendedClasses;

            const afterPercentage = afterTotal === 0
                ? 100
                : (afterAttended / afterTotal) * 100;

            impacts.push({
                subjectName: stat.subjectName,
                currentPercentage: parseFloat(currentPercentage.toFixed(1)),
                afterPercentage: parseFloat(afterPercentage.toFixed(1)),
                drop: (currentPercentage - afterPercentage).toFixed(1),
                classesMissed: classesOnSelectedDates
            });
        }

        res.json({ impacts });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

router.get('/day-attendance/:classId/:rollNumber/:date', async (req, res) => {
    try {
        const { classId, rollNumber, date } = req.params;
        const rollNo = parseInt(rollNumber);

        const queryDate = new Date(date);
        queryDate.setHours(0, 0, 0, 0);

        const attendanceRecord = await Attendance.findOne({
            classId,
            date: queryDate
        });

        if (!attendanceRecord || !attendanceRecord.periods) {
            return res.json({ periods: [] });
        }

        const periodsWithStatus = attendanceRecord.periods.map(period => ({
            periodNum: period.periodNum,
            subjectName: period.subjectName,
            status: period.absentRollNumbers.includes(rollNo) ? 'Absent' : 'Present'
        }));

        res.json({ periods: periodsWithStatus });
    } catch (err) {
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
            const relevantPeriods = record.periods.filter(p => p.subjectId === subjectId);

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