const mongoose = require('mongoose');

const ClassroomSchema = new mongoose.Schema({
    // FIX: Add unique: true and trim whitespace
    className: {
        type: String,
        required: true,
        trim: true
    },
    adminPin: { type: String, required: true },
    totalStudents: { type: Number, required: true },

    subjects: [{
        name: { type: String, required: true },
        code: { type: String },
        totalClassesExpected: { type: Number, default: 40 }
    }],

    createdAt: { type: Date, default: Date.now }
});

// Case-insensitive unique index: "CSE B", "cse b", "Cse B" are all treated as the same class
ClassroomSchema.index({ className: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = mongoose.model('Classroom', ClassroomSchema);