const mongoose = require('mongoose');

const AnnouncementSchema = new mongoose.Schema({
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    subjectId: { type: String, default: null },
    subjectName: { type: String, default: 'General' },
    dueDate: { type: Date, default: null }
}, { timestamps: true });

// Index for efficient querying  
AnnouncementSchema.index({ classId: 1, createdAt: -1 });

module.exports = mongoose.model('Announcement', AnnouncementSchema);
