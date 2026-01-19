const mongoose = require('mongoose');

const ClassroomSchema = new mongoose.Schema({
  className: { type: String, required: true }, 
  adminPin: { type: String, required: true }, 
  totalStudents: { type: Number, required: true }, 

  subjects: [{
    name: { type: String, required: true },
    code: { type: String },
    totalClassesExpected: { type: Number, default: 40 } 
  }],

  timetable: {
    Monday:    [{ period: Number, subjectId: String }],
    Tuesday:   [{ period: Number, subjectId: String }],
    Wednesday: [{ period: Number, subjectId: String }],
    Thursday:  [{ period: Number, subjectId: String }],
    Friday:    [{ period: Number, subjectId: String }],
    Saturday:  [{ period: Number, subjectId: String }]
  },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Classroom', ClassroomSchema);