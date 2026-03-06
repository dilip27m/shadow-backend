const mongoose = require('mongoose');

const StudentRecordSchema = new mongoose.Schema({
    classId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Classroom',
        required: true
    },
    rollNumber: {
        type: String,
        required: true,
        trim: true
    },

    // Pre-computed per-subject attendance stats
    subjects: [{
        subjectId: { type: String, required: true },
        subjectName: { type: String, required: true },
        totalClasses: { type: Number, default: 0 },
        attendedClasses: { type: Number, default: 0 }
    }],

    // Day-level attendance log for history & calendar views
    dayLog: [{
        date: { type: Date, required: true },
        periods: [{
            periodNum: { type: Number, required: true },
            subjectId: { type: String },
            subjectName: { type: String },
            status: { type: String, enum: ['Present', 'Absent', 'Present (DL)'], required: true }
        }]
    }],

    lastSyncedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Primary lookup: one record per student per class
StudentRecordSchema.index({ classId: 1, rollNumber: 1 }, { unique: true });

// Fast date-based queries within a student's dayLog
StudentRecordSchema.index({ classId: 1, 'dayLog.date': 1 });

module.exports = mongoose.model('StudentRecord', StudentRecordSchema);
