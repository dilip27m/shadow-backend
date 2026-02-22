const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
    classId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Classroom',
        required: true
    },
    studentRoll: {
        type: String,
        required: true
    },
    date: {
        type: String, // YYYY-MM-DD format
        required: true
    },
    subjectId: {
        type: String,
        required: true
    },
    subjectName: {
        type: String,
        required: true
    },
    issueDescription: {
        type: String,
        required: true,
        maxlength: 500
    },
    status: {
        type: String,
        enum: ['pending', 'resolved', 'rejected'],
        default: 'pending'
    },
    adminResponse: {
        type: String,
        maxlength: 500
    }
}, { timestamps: true });

// Indexes for fast queries
ReportSchema.index({ classId: 1, status: 1 });
ReportSchema.index({ classId: 1, studentRoll: 1 });
ReportSchema.index({ classId: 1, createdAt: -1 });

module.exports = mongoose.model('Report', ReportSchema);
