const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

// Configure web-push with VAPID keys
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(
        'mailto:shadow-app@example.com',
        vapidPublicKey,
        vapidPrivateKey
    );
}

/**
 * Send push notification to all subscribers of a class.
 * @param {string} classId - The class ID to broadcast to
 * @param {object} payload - { title, body, url }
 */
const sendPushToClass = async (classId, { title, body, url }) => {
    if (!vapidPublicKey || !vapidPrivateKey) {
        console.warn('VAPID keys not configured, skipping push notifications.');
        return;
    }

    try {
        const subscriptions = await PushSubscription.find({ classId }).lean();

        if (subscriptions.length === 0) return;

        const payload = JSON.stringify({
            title: title || 'Shadow',
            body: body || 'You have a new update.',
            url: url || '/',
            icon: '/icon-192.png',
            badge: '/logo_92.png'
        });

        const expiredEndpoints = [];

        const results = await Promise.allSettled(
            subscriptions.map(sub =>
                webpush.sendNotification(sub.subscription, payload).catch(err => {
                    // 410 Gone or 404 = subscription expired/invalid
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        expiredEndpoints.push(sub.subscription.endpoint);
                    }
                    throw err;
                })
            )
        );

        // Auto-cleanup expired subscriptions
        if (expiredEndpoints.length > 0) {
            await PushSubscription.deleteMany({
                'subscription.endpoint': { $in: expiredEndpoints }
            });
            console.log(`Cleaned up ${expiredEndpoints.length} expired push subscription(s).`);
        }

        const sent = results.filter(r => r.status === 'fulfilled').length;
        console.log(`Push notifications: ${sent}/${subscriptions.length} delivered for class ${classId}`);
    } catch (err) {
        console.error('Push notification broadcast error:', err);
    }
};

module.exports = { sendPushToClass };
