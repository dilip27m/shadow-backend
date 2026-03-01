const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ClassroomSchema = new mongoose.Schema({
    className: {
        type: String,
        required: [true, 'Class name is required'],
        trim: true
    },
    semester: {
        type: Number,
        required: [true, 'Semester is required'],
        min: [1, 'Semester must be between 1 and 8'],
        max: [8, 'Semester must be between 1 and 8']
    },
    academicYear: {
        type: String,
        required: [true, 'Academic year is required'],
        trim: true
        // e.g. "2025-2026"
    },
    isApproved: {
        type: Boolean,
        default: false
    },

    // Admin authentication
    adminEmail: {
        type: String,
        required: [true, 'Admin email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address']
    },
    adminPassword: {
        type: String,
        required: [true, 'Admin password is required'],
        minlength: [8, 'Password must be at least 8 characters'],
        select: false // Never returned in queries by default
    },

    subjects: [{
        name: { type: String, required: true, trim: true },
        code: { type: String, trim: true }
    }],

    // Stored at creation time so the approval route can regenerate the student list
    rangeConfig: {
        start: { type: String, required: true },
        end: { type: String, required: true },
        emailTemplate: { type: String } // Optional: only used if email-based onboarding is enabled
    }
}, { timestamps: true });

// Case-insensitive unique index: "CSE B", "cse b", "Cse B" are all treated as the same class
ClassroomSchema.index(
    { className: 1 },
    { name: 'className_ci_unique', unique: true, collation: { locale: 'en', strength: 2 } }
);

// ─── Pre-save Hook: Hash admin password ───
ClassroomSchema.pre('save', async function (next) {
    if (!this.isModified('adminPassword')) return next();
    try {
        const salt = await bcrypt.genSalt(12);
        this.adminPassword = await bcrypt.hash(this.adminPassword, salt);
        next();
    } catch (err) {
        next(err);
    }
});

// ─── Instance Method: Compare admin password ───
ClassroomSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.adminPassword);
};

module.exports = mongoose.model('Classroom', ClassroomSchema);
