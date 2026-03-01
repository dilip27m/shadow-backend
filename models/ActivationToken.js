const mongoose = require('mongoose');

const ActivationTokenSchema = new mongoose.Schema({
    token: {
        type: String,
        required: [true, 'Token is required'],
        index: true
    },
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: [true, 'Student reference is required']
    },
    expiresAt: {
        type: Date,
        required: [true, 'Expiration date is required']
    }
}, { timestamps: true });

// TTL index: MongoDB auto-deletes documents when expiresAt is reached
ActivationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ActivationToken', ActivationTokenSchema);
