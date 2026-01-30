const mongoose = require('mongoose');

const ClassroomSchema = new mongoose.Schema({
    // FIX: Add unique: true and trim whitespace
    className: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    adminPin: { type: String, required: true },
    totalStudents: { type: Number, required: true },

    subjects: [{
        name: { type: String, required: true },
        code: { type: String },
        totalClassesExpected: { type: Number, default: 40 },
        teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', default: null }, // Link subject to a teacher
        teacherStatus: { type: String, enum: ['Pending', 'Accepted'], default: 'Pending' }
    }],

    timetable: {
        Monday: [{ period: Number, subjectId: String }],
        Tuesday: [{ period: Number, subjectId: String }],
        Wednesday: [{ period: Number, subjectId: String }],
        Thursday: [{ period: Number, subjectId: String }],
        Friday: [{ period: Number, subjectId: String }],
        Saturday: [{ period: Number, subjectId: String }]
    },

    settings: {
        minAttendancePercentage: { type: Number, default: 75 },
        permanentAbsentees: [{ type: Number }]
    },

    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Classroom', ClassroomSchema);