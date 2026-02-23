const express = require('express');
const router = express.Router();
const PushSubscription = require('../models/PushSubscription');

// Return the public VAPID key so the frontend can subscribe
router.get('/vapid-key', (req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) {
        return res.status(500).json({ error: 'Push notifications are not configured.' });
    }
    res.json({ publicKey: key });
});

// Subscribe to push notifications for a class
router.post('/subscribe', async (req, res) => {
    try {
        const { classId, rollNumber, subscription } = req.body;

        if (!classId || !subscription || !subscription.endpoint || !subscription.keys) {
            return res.status(400).json({ error: 'classId and valid subscription are required.' });
        }

        // Upsert: update if same endpoint exists for this class, otherwise create
        await PushSubscription.findOneAndUpdate(
            { classId, 'subscription.endpoint': subscription.endpoint },
            {
                classId,
                rollNumber: rollNumber || null,
                subscription
            },
            { upsert: true, new: true }
        );

        res.json({ message: 'Subscribed to push notifications.' });
    } catch (err) {
        console.error('Push subscribe error:', err);
        res.status(500).json({ error: 'Failed to subscribe.' });
    }
});

// Unsubscribe from push notifications
router.post('/unsubscribe', async (req, res) => {
    try {
        const { classId, endpoint } = req.body;

        if (!endpoint) {
            return res.status(400).json({ error: 'endpoint is required.' });
        }

        const filter = { 'subscription.endpoint': endpoint };
        if (classId) filter.classId = classId;

        await PushSubscription.deleteMany(filter);
        res.json({ message: 'Unsubscribed from push notifications.' });
    } catch (err) {
        console.error('Push unsubscribe error:', err);
        res.status(500).json({ error: 'Failed to unsubscribe.' });
    }
});

module.exports = router;
