const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ─── Sub-schemas ───
const MarksSchema = new mongoose.Schema({
    subjectId: { type: String, required: true },
    subjectName: { type: String, required: true },
    internal: {
        type: Number,
        required: true,
        min: [0, 'Internal marks cannot be negative'],
        max: [40, 'Internal marks cannot exceed 40']
    },
    external: {
        type: Number,
        required: true,
        min: [0, 'External marks cannot be negative'],
        max: [60, 'External marks cannot exceed 60']
    }
}, { _id: false });

const LinkSchema = new mongoose.Schema({
    label: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true }
}, { _id: false });

const AttendanceSummarySchema = new mongoose.Schema({
    attended: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 }
}, { _id: false });

// ─── Student Schema ───
const StudentSchema = new mongoose.Schema({
    // Identity
    rollNumber: {
        type: String,
        required: [true, 'Roll number is required'],
        trim: true
    },
    classId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Classroom',
        required: [true, 'Class reference is required']
    },

    // Secret Key Onboarding
    secretKey: {
        type: String, // bcrypt-hashed, plain text is never stored
        select: false
    },
    isClaimed: {
        type: Boolean,
        default: false
    },

    // Auth (set during claim)
    password: {
        type: String,
        select: false // Never returned in queries by default
    },

    // Optional recovery email (set during or after claim)
    email: {
        type: String,
        lowercase: true,
        trim: true,
        sparse: true, // allows multiple nulls in the unique index
        match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
        default: null
    },

    // Academic Data
    cgpa: {
        type: Number,
        min: [0, 'CGPA cannot be negative'],
        max: [10, 'CGPA cannot exceed 10'],
        default: null
    },
    marks: [MarksSchema],
    importantLinks: [LinkSchema],

    // Performance: Pre-calculated attendance stats per subject
    // Key = subjectId, Value = { attended, total }
    summary: {
        type: Map,
        of: AttendanceSummarySchema,
        default: () => new Map()
    }
}, { timestamps: true });

// ─── Indexes ───
// Primary lookup: "give me this student in this class"
StudentSchema.index({ classId: 1, rollNumber: 1 }, { unique: true });
// Sparse unique on email (only enforced when email is not null)
StudentSchema.index({ email: 1 }, { unique: true, sparse: true });

// ─── Pre-save Hook: Hash password and secretKey ───
StudentSchema.pre('save', async function (next) {
    try {
        if (this.isModified('password') && this.password) {
            const salt = await bcrypt.genSalt(12);
            this.password = await bcrypt.hash(this.password, salt);
        }
        if (this.isModified('secretKey') && this.secretKey) {
            const salt = await bcrypt.genSalt(10);
            this.secretKey = await bcrypt.hash(this.secretKey, salt);
        }
        next();
    } catch (err) {
        next(err);
    }
});

// ─── Instance Methods ───
StudentSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

StudentSchema.methods.compareSecretKey = async function (candidateKey) {
    return bcrypt.compare(candidateKey, this.secretKey);
};

module.exports = mongoose.model('Student', StudentSchema);
