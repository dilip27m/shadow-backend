const mongoose = require('mongoose');

const TeacherSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    teacherCode: { type: String, required: true, unique: true, minlength: 4, maxlength: 6 },

    assignedClasses: [{
        classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom' },
        subjectId: { type: mongoose.Schema.Types.ObjectId } // Not a Ref, just the subdocument ID
    }],

    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Teacher', TeacherSchema);
