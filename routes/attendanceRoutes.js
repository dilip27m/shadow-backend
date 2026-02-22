const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const auth = require('../middleware/auth');

// FIX: Extract date string directly to avoid timezone-driven day shifts
const normalizeDate = (dateString) => {
    // Take only the YYYY-MM-DD part before any 'T' character, avoiding UTC conversion
    const datePart = String(dateString).split('T')[0];
    return new Date(`${datePart}T00:00:00.000Z`);
};

const Classroom = require('../models/Classroom');
const Teacher = require('../models/Teacher');

// @route   POST /api/attendance/mark
router.post('/mark', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const { classId, date, periods } = req.body;

        if (!classId || !date || !periods) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const classroom = await Classroom.findById(classId);
        if (!classroom) {
            return res.status(404).json({ error: 'Class not found' });
        }

        const searchDate = normalizeDate(date);
        const normalizedPeriods = normalizePeriodsForStorage(periods);

        // Fetch existing record to check for previous verifications
        const existingRecord = await Attendance.findOne({ classId, date: searchDate });

        // Process periods to handle verification
        const processedPeriods = await Promise.all(periods.map(async (p) => {
            let isVerified = false;
            let verifiedBy = null;

            // Find the subject definition to get teacherId
            const subjectDef = classroom.subjects.find(s => s._id.toString() === p.subjectId);

            console.log('📝 Processing period:', p.subjectName);
            console.log('   SubjectId sent:', p.subjectId);
            console.log('   Subject found in class:', subjectDef ? subjectDef.name : 'NOT FOUND');
            console.log('   TeacherId:', subjectDef?.teacherId);
            console.log('   Verification code sent:', p.verificationCode);

            // Check if already verified in DB (if no code provided this time)
            if (!p.verificationCode && existingRecord) {
                const existingPeriod = existingRecord.periods.find(ep => ep.periodNum === p.periodNum);
                // Only preserve if subject hasn't changed
                if (existingPeriod && existingPeriod.isVerified && existingPeriod.subjectId === p.subjectId) {
                    isVerified = true;
                    verifiedBy = existingPeriod.verifiedBy;
                    console.log('   ♻️ Preserving previous verification');
                }
            }

            if (subjectDef && subjectDef.teacherId && p.verificationCode) {
                const teacher = await Teacher.findById(subjectDef.teacherId);
                console.log('   Teacher found:', teacher?.name);
                console.log('   Teacher code in DB:', teacher?.teacherCode);
                console.log('   Codes match:', teacher?.teacherCode === p.verificationCode);

                if (teacher && teacher.teacherCode === p.verificationCode) {
                    isVerified = true;
                    verifiedBy = teacher._id;
                    console.log('   ✅ VERIFIED');
                } else {
                    console.log('   ❌ PIN MISMATCH');
                }
            } else {
                console.log('   ⏭️ Skipping verification (no teacher or no code)');
            }

            return {
                ...p,
                isVerified,
                verifiedBy
            };
        }));

        // const searchDate = normalizeDate(date); // Moved up

        const updatedRecord = await Attendance.findOneAndUpdate(
            { classId: classId, date: searchDate },
            { $set: { periods: processedPeriods } },
            { new: true, upsert: true }
        );

        res.json({ message: 'Attendance Saved Successfully!', data: updatedRecord });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
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
        const records = await Attendance.find({ classId }).select('date -_id').sort({ date: -1 }).lean();

        const dates = records.map(r => r.date);
        res.json({ dates });
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   GET /api/attendance/stats/subject/:classId/:subjectId
// @desc    Get attendance stats for a specific subject (Teacher View)
router.get('/stats/subject/:classId/:subjectId', auth, async (req, res) => {
    try {
        const { classId, subjectId } = req.params;

        // Verify Teacher Access
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const classroom = await Classroom.findById(classId);
        if (!classroom) return res.status(404).json({ error: 'Class not found' });

        // Verify teacher is assigned to this subject
        const subject = classroom.subjects.id(subjectId);
        if (!subject) return res.status(404).json({ error: 'Subject not found' });

        // Ensure the requesting teacher is the one assigned
        if (subject.teacherId.toString() !== req.user.teacherId) {
            return res.status(403).json({ error: 'You are not assigned to this subject' });
        }

        // Fetch all attendance records for this class
        const attendanceRecords = await Attendance.find({ classId });

        // Initialize stats for all students
        const stats = {};
        const totalStudents = classroom.totalStudents;

        for (let i = 1; i <= totalStudents; i++) {
            stats[i] = { rollNumber: i, present: 0, absent: 0, total: 0 };
        }

        // Process records
        attendanceRecords.forEach(record => {
            // Find periods for this subject in this record
            const relevantPeriods = record.periods.filter(p => p.subjectId === subjectId);

            relevantPeriods.forEach(p => {
                // For this period...
                for (let i = 1; i <= totalStudents; i++) {
                    stats[i].total += 1;
                    if (p.absentRollNumbers.includes(i)) {
                        stats[i].absent += 1;
                    } else {
                        stats[i].present += 1;
                    }
                }
            });
        });

        // Calculate percentages and format as array
        const results = Object.values(stats).map(s => ({
            ...s,
            percentage: s.total === 0 ? 0 : Math.round((s.present / s.total) * 100)
        }));

        res.json({
            className: classroom.className,
            subjectName: subject.name,
            totalClasses: results[0]?.total || 0, // Assuming all students have same total classes if started together
            students: results
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;
