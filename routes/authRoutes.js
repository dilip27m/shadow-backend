const express = require('express');
const router = express.Router();
const asyncHandler = require('express-async-handler');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const Student = require('../models/Student');
const Classroom = require('../models/Classroom');

// ─── Auth-specific Rate Limiters ─────────────────────────────────────────────

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

const claimLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many claim attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const claimSchema = z.object({
    rollNumber: z.string().trim().min(1, 'Roll number is required'),
    classId: z.string().trim().min(1, 'Class ID is required'),
    secretKey: z.string().trim().min(1, 'Secret key is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    recoveryEmail: z.string().trim().toLowerCase().email('Invalid email format').optional()
});

const loginSchema = z.object({
    rollNumber: z.string().trim().min(1, 'Roll number is required'),
    classId: z.string().trim().min(1, 'Class ID is required'),
    password: z.string().min(1, 'Password is required')
});

const adminLoginSchema = z.object({
    email: z.string().trim().toLowerCase().min(1, 'Email is required').email('Invalid email format'),
    password: z.string().min(1, 'Password is required')
});

const formatZodErrors = (error) => {
    return error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message
    }));
};

// ═════════════════════════════════════════════════════════════════════════════
//  POST /api/auth/claim-account
//  Student claims account using rollNumber + secretKey, sets password
// ═════════════════════════════════════════════════════════════════════════════

router.post('/claim-account', claimLimiter, asyncHandler(async (req, res) => {
    // 1. Validate input
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            error: 'Validation failed',
            details: formatZodErrors(parsed.error)
        });
    }

    const { rollNumber, classId, secretKey, newPassword, recoveryEmail } = parsed.data;

    // 2. Find student with secretKey field
    const student = await Student.findOne({ rollNumber, classId }).select('+secretKey +password');

    if (!student) {
        return res.status(404).json({ error: 'Student not found. Check your roll number and class.' });
    }

    if (student.isClaimed) {
        return res.status(400).json({ error: 'This account has already been claimed.' });
    }

    if (!student.secretKey) {
        return res.status(400).json({ error: 'No secret key found for this account. Contact your admin.' });
    }

    // 3. Verify secret key
    const isMatch = await student.compareSecretKey(secretKey);
    if (!isMatch) {
        return res.status(401).json({ error: 'Invalid secret key.' });
    }

    // 4. Claim the account
    student.password = newPassword; // pre-save hook will hash
    student.isClaimed = true;
    student.secretKey = null; // Destroy the key — single use only
    if (recoveryEmail) {
        student.email = recoveryEmail;
    }
    await student.save();

    // 5. Issue JWT
    const token = jwt.sign(
        { id: student._id, role: 'student', classId: student.classId.toString(), rollNumber: student.rollNumber },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
    );

    res.json({
        message: 'Account claimed successfully!',
        token,
        student: {
            id: student._id,
            rollNumber: student.rollNumber,
            classId: student.classId
        }
    });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  POST /api/auth/login
//  Unified login: Student (rollNumber + classId + password) or Admin (email + password)
// ═════════════════════════════════════════════════════════════════════════════

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
    const body = req.body;

    // ── Branch 1: Student login (rollNumber + classId + password) ──
    if (body.rollNumber && body.classId) {
        const parsed = loginSchema.safeParse(body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: formatZodErrors(parsed.error)
            });
        }

        const { rollNumber, classId, password } = parsed.data;

        const student = await Student.findOne({ rollNumber, classId }).select('+password');

        if (!student) {
            return res.status(401).json({ error: 'Invalid roll number, class, or password.' });
        }

        if (!student.isClaimed) {
            return res.status(403).json({
                error: 'Account not yet claimed. Use your secret key to claim your account first.'
            });
        }

        const isMatch = await student.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid roll number, class, or password.' });
        }

        const token = jwt.sign(
            { id: student._id, role: 'student', classId: student.classId.toString(), rollNumber: student.rollNumber },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        return res.json({
            message: 'Login successful',
            token,
            user: {
                id: student._id,
                role: 'student',
                rollNumber: student.rollNumber,
                classId: student.classId
            }
        });
    }

    // ── Branch 2: Admin login (email + password) ──
    if (body.email) {
        const parsed = adminLoginSchema.safeParse(body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: formatZodErrors(parsed.error)
            });
        }

        const { email, password } = parsed.data;

        const classroom = await Classroom.findOne({ adminEmail: email }).select('+adminPassword');

        if (!classroom) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const isMatch = await classroom.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const token = jwt.sign(
            { id: classroom._id, role: 'admin', classId: classroom._id.toString() },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        return res.json({
            message: 'Login successful',
            token,
            user: {
                id: classroom._id,
                email: classroom.adminEmail,
                role: 'admin',
                className: classroom.className,
                classId: classroom._id
            }
        });
    }

    // ── Neither ──
    return res.status(400).json({
        error: 'Please provide either (rollNumber + classId + password) for student login or (email + password) for admin login.'
    });
}));

module.exports = router;
