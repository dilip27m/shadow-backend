const mongoose = require('mongoose');

const PushSubscriptionSchema = new mongoose.Schema({
    classId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Classroom',
        required: true
    },
    rollNumber: {
        type: String,
        default: null
    },
    subscription: {
        endpoint: { type: String, required: true },
        keys: {
            p256dh: { type: String, required: true },
            auth: { type: String, required: true }
        }
    },
    createdAt: { type: Date, default: Date.now }
});

// Index for fast class-based lookup when broadcasting
PushSubscriptionSchema.index({ classId: 1 });
// Compound index for fast per-student lookup
PushSubscriptionSchema.index({ classId: 1, rollNumber: 1 });
// Unique constraint: one subscription per endpoint per class
PushSubscriptionSchema.index({ classId: 1, 'subscription.endpoint': 1 }, { unique: true });

module.exports = mongoose.model('PushSubscription', PushSubscriptionSchema);
