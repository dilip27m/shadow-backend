const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true },
  date: { type: Date, required: true },
  
  periods: [{
    periodNum: Number,      
    subjectId: String,       
    subjectName: String,     
    

    absentRollNumbers: [{ type: Number }] 
  }]
});

AttendanceSchema.index({ classId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', AttendanceSchema);