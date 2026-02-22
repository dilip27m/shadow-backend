const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true },
    date: { type: Date, required: true },

    periods: [{
        periodNum: Number,
        subjectId: String,
        subjectName: String,


        absentRollNumbers: [{ type: String }]
    }]
}, { timestamps: true }); // Add timestamps for createdAt and updatedAt

AttendanceSchema.index({ classId: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ classId: 1, updatedAt: -1 });
AttendanceSchema.index({ classId: 1, 'periods.subjectId': 1, date: -1 });

module.exports = mongoose.model('Attendance', AttendanceSchema);
