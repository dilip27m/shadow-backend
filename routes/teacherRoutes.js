const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Teacher = require('../models/Teacher');
const Classroom = require('../models/Classroom');
const Attendance = require('../models/Attendance');
const ModificationRequest = require('../models/ModificationRequest');
const auth = require('../middleware/auth');

// @route   POST /api/auth/teacher/login
// @desc    Teacher Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const teacher = await Teacher.findOne({ email });
        if (!teacher) {
            return res.status(400).json({ error: 'Invalid Credentials' });
        }

        const isMatch = await bcrypt.compare(password, teacher.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid Credentials' });
        }

        const payload = {
            teacherId: teacher._id,
            role: 'teacher'
        };

        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({ token, teacherId: teacher._id, name: teacher.name });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   GET /api/teacher/dashboard
// @desc    Get assigned classes and subjects
router.get('/dashboard', auth, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Access denied. Teachers only.' });
        }

        const teacher = await Teacher.findById(req.user.teacherId).populate('assignedClasses.classId', 'className');

        if (!teacher) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        // We need to fetch subject names and status from Classroom
        const enhancedClasses = await Promise.all(teacher.assignedClasses.map(async (assignment) => {
            // Safety check: if class was deleted or populate failed
            if (!assignment.classId) {
                return {
                    subjectId: assignment.subjectId,
                    subjectName: 'Deleted Class',
                    status: 'Error',
                    classId: { className: 'Unknown' }
                };
            }

            try {
                // assignment.classId is the populated object (with only className)
                // We need the full classroom to get sub-doc
                const classroom = await Classroom.findById(assignment.classId._id);

                if (!classroom) {
                    return {
                        classId: assignment.classId,
                        subjectId: assignment.subjectId,
                        subjectName: 'Class Not Found',
                        status: 'Error'
                    };
                }

                // Use standard array find for safety
                // Ensure Subject ID comparison handles ObjectId vs String
                const subject = classroom.subjects.find(s =>
                    s._id.toString() === assignment.subjectId.toString()
                );

                // Normalize status to Title Case (Pending, Accepted)
                let rawStatus = subject ? subject.teacherStatus : 'Pending';
                if (!rawStatus) rawStatus = 'Pending';
                const status = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase();

                return {
                    classId: assignment.classId,
                    subjectId: assignment.subjectId,
                    subjectName: subject ? subject.name : 'Subject Not Found', // Changed from Unknown to differentiate
                    status: status
                };
            } catch (innerErr) {
                console.error(`Error processing assignment for teacher ${teacher._id}:`, innerErr);
                return {
                    classId: assignment.classId,
                    subjectId: assignment.subjectId,
                    subjectName: `Error: ${innerErr.message}`, // Return actual error
                    status: 'Error'
                };
            }
        }));

        const responseData = {
            ...teacher.toObject(),
            assignedClasses: enhancedClasses
        };

        console.log(`[Dashboard] Sending data for ${teacher.email}:`, JSON.stringify(responseData.assignedClasses));

        res.json(responseData);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   GET /api/teacher/requests
// @desc    Get pending modification requests for this teacher
router.get('/requests', auth, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Access denied. Teachers only.' });
        }

        const teacher = await Teacher.findById(req.user.teacherId);
        if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

        // Find requests for subjects assigned to this teacher
        // We need to filter ModificationRequests where (classId, subjectId) matches one of the teacher's assignments
        // Complex query: $or array of { classId, subjectId } 
        // But simpler: just find all requests and filter in code or use $in if we had list of subjectIds.
        // Teacher assignments: [{ classId, subjectId }, ...]

        const validAssignments = teacher.assignedClasses.map(a => ({
            classId: a.classId,
            subjectId: a.subjectId
        }));

        if (validAssignments.length === 0) {
            return res.json([]);
        }

        const requests = await ModificationRequest.find({
            $or: validAssignments,
            status: 'Pending'
        }).populate('classId', 'className');

        res.json(requests);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   POST /api/teacher/requests/:id
// @desc    Approve or Reject a request
router.post('/requests/:id', auth, async (req, res) => {
    try {
        const { status } = req.body; // 'Approved' or 'Rejected'
        const requestId = req.params.id;

        if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Access Denied' });

        const request = await ModificationRequest.findById(requestId);
        if (!request) return res.status(404).json({ error: 'Request not found' });

        // Verify this teacher is allowed to handle this request
        const teacher = await Teacher.findById(req.user.teacherId);
        const isAssigned = teacher.assignedClasses.some(
            a => a.classId.toString() === request.classId.toString() &&
                a.subjectId.toString() === request.subjectId.toString()
        );

        if (!isAssigned) {
            return res.status(403).json({ error: 'You are not assigned to this subject.' });
        }

        request.status = status;
        await request.save();

        if (status === 'Approved') {
            // Update the actual Attendance record
            // 1. Find the Attendance document for that Class and Date
            const attendance = await Attendance.findOne({
                classId: request.classId,
                date: request.date
            });

            if (attendance) {
                // 2. Find the specific period/subject
                const period = attendance.periods.find(p => p.subjectId.toString() === request.subjectId.toString());

                if (period) {
                    // 3. Remove student from absent list (mark present) or add?
                    // Usually requests are "I was present but marked absent".
                    // So we remove from absentRollNumbers.
                    period.absentRollNumbers = period.absentRollNumbers.filter(r => r !== request.studentId);

                    // Mark as manually verified/modified?
                    // Maybe we should log this change? For now, just save.
                    await attendance.save();
                }
            }
        }

        res.json({ message: `Request ${status}` });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// @route   POST /api/teacher/change-password
// @desc    Change Teacher Password
router.post('/change-password', auth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Access Denied' });
        }

        const teacher = await Teacher.findById(req.user.teacherId);
        if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

        const isMatch = await bcrypt.compare(currentPassword, teacher.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid Current Password' });
        }

        const salt = await bcrypt.genSalt(10);
        teacher.password = await bcrypt.hash(newPassword, salt);
        await teacher.save();

        res.json({ message: 'Password Updated Successfully' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;
