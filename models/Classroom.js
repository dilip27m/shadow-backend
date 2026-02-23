const mongoose = require('mongoose');

const ClassroomSchema = new mongoose.Schema({
    // Keep this field simple; uniqueness is enforced by the collation index below
    className: {
        type: String,
        required: true,
        trim: true
    },
    adminPin: { type: String, required: true },
    rollNumbers: {
        type: [String],
        required: true,
        validate: {
            validator: (value) => Array.isArray(value) && value.length > 0,
            message: 'At least one roll number is required'
        }
    },

    subjects: [{
        name: { type: String, required: true },
        code: { type: String },
        totalClassesExpected: { type: Number, default: 40 }
    }],

    blockedRollNumbers: {
        type: [String],
        default: []
    },

    createdAt: { type: Date, default: Date.now }
});

// Case-insensitive unique index: "CSE B", "cse b", "Cse B" are all treated as the same class
ClassroomSchema.index(
    { className: 1 },
    { name: 'className_ci_unique', unique: true, collation: { locale: 'en', strength: 2 } }
);

module.exports = mongoose.model('Classroom', ClassroomSchema);
