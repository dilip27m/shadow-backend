const mongoose = require('mongoose');

const ModificationRequestSchema = new mongoose.Schema({
    studentId: { type: Number, required: true }, // Roll number
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, required: true },
    date: { type: Date, required: true },

    // Status of the request
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending'
    },

    // Who requested the change (Student Roll Number)
    requestedBy: { type: Number, required: true },

    // Optional reason provided by student
    reason: { type: String },

    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ModificationRequest', ModificationRequestSchema);
