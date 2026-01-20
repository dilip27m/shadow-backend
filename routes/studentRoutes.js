const express = require('express');
const router = express.Router();
const Classroom = require('../models/Classroom');
const Attendance = require('../models/Attendance');

// Get overall attendance report
router.get('/report/:classId/:rollNumber', async (req, res) => {
    try {
        const { classId, rollNumber } = req.params;
        const rollNo = parseInt(rollNumber);

        const classroom = await Classroom.findById(classId);
        if (!classroom) return res.status(404).json({ error: 'Class not found' });

        const allRecords = await Attendance.find({ classId });

        let report = {};

        // Initialize report structure
        classroom.subjects.forEach(sub => {
            report[sub._id] = {
                subjectName: sub.name,
                totalClasses: 0,
                attendedClasses: 0,
                status: "Neutral"
            };
        });

        // Calculate attendance
        allRecords.forEach(day => {
            day.periods.forEach(p => {
                const subId = p.subjectId;
                if (report[subId]) {
                    report[subId].totalClasses += 1;
                    if (!p.absentRollNumbers.includes(rollNo)) {
                        report[subId].attendedClasses += 1;
                    }
                }
            });
        });

        // Finalize calculations
        const finalReport = Object.values(report).map(subject => {
            const { totalClasses, attendedClasses } = subject;
            const percentage = totalClasses === 0 ? 100 : ((attendedClasses / totalClasses) * 100).toFixed(1);

            let bunkMsg = "";
            const minPercentage = classroom.settings?.minAttendancePercentage || 75;

            if (percentage >= minPercentage + 5) { // Safe buffer
                const canBunk = Math.floor((attendedClasses / (minPercentage/100)) - totalClasses);
                bunkMsg = `Safe! You can bunk ${Math.max(0, canBunk)} more classes.`;
            } else if (percentage < minPercentage) {
                const mustAttend = Math.ceil(((minPercentage/100) * totalClasses - attendedClasses) / (1 - (minPercentage/100)));
                bunkMsg = `Danger! Attend next ${Math.max(1, mustAttend)} classes to recover.`;
            } else {
                bunkMsg = "Borderline! Be careful.";
            }

            return {
                ...subject,
                percentage: parseFloat(percentage),
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
        console.error(err);
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

        const allRecords = await Attendance.find({ classId });

        // 1. Calculate Current Status
        let currentStats = {};
        classroom.subjects.forEach(sub => {
            // Using ID as key for easier lookup
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

        // Iterate over stats using keys to access IDs directly
        for (const [subjectId, stat] of Object.entries(currentStats)) {
            
            let classesOnSelectedDates = 0;
            
            dates.forEach(date => {
                const d = new Date(date);
                const dayOfWeek = days[d.getDay()];
                const daySchedule = classroom.timetable?.[dayOfWeek] || [];
                
                // CRITICAL FIX: Convert both to String for comparison
                const hasClass = daySchedule.some(slot => String(slot.subjectId) === String(subjectId));
                
                if (hasClass) classesOnSelectedDates++;
            });

            const currentPercentage = stat.totalClasses === 0
                ? 100
                : (stat.attendedClasses / stat.totalClasses) * 100;

            const afterTotal = stat.totalClasses + classesOnSelectedDates;
            const afterAttended = stat.attendedClasses; // Bunking, so attended count doesn't increase
            
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

        // Normalize date to start of day for accurate query
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

module.exports = router;