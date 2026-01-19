const express = require('express');
const router = express.Router();
const Classroom = require('../models/Classroom');
const Attendance = require('../models/Attendance');


router.get('/report/:classId/:rollNumber', async (req, res) => {
  try {
    const { classId, rollNumber } = req.params;
    const rollNo = parseInt(rollNumber); 


    const classroom = await Classroom.findById(classId);
    if (!classroom) return res.status(404).json({ error: 'Class not found' });


    const allRecords = await Attendance.find({ classId });

    let report = {};


    classroom.subjects.forEach(sub => {
      report[sub._id] = {
        subjectName: sub.name,
        totalClasses: 0,
        attendedClasses: 0,
        status: "Neutral" 
      };
    });


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


    const finalReport = Object.values(report).map(subject => {
      const { totalClasses, attendedClasses } = subject;
      

      const percentage = totalClasses === 0 ? 100 : ((attendedClasses / totalClasses) * 100).toFixed(1);
      

      let bunkMsg = "";
      
      if (percentage >= 80) {
        // Formula: How many more can I miss and stay above 75%?
        // (Present / 0.75) - Total
        const canBunk = Math.floor((attendedClasses / 0.75) - totalClasses);
        bunkMsg = `Safe! You can bunk ${canBunk} more classes.`;
      } else {
        // Formula: How many must I attend to reach 75%?
        // (3 * Total - 4 * Present) ... simplified derivation
        const mustAttend = Math.ceil((0.75 * totalClasses - attendedClasses) / (1 - 0.75));
        // Simple approximation for V1
        bunkMsg = `Danger! Attend next few classes to recover.`;
      }

      return {
        ...subject,
        percentage: percentage + "%",
        message: bunkMsg
      };
    });

    res.json({
      studentRoll: rollNo,
      className: classroom.className,
      report: finalReport
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
});

module.exports = router;