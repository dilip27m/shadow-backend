/**
 * Reminder Cron Job
 * Runs daily at 8:00 AM — sends a push notification to each class
 * for every announcement due the following day.
 */
const cron = require('node-cron');
const Announcement = require('../models/Announcement');
const { sendPushToClass } = require('../utils/pushService');

const startReminderCron = () => {
    // Runs every day at 8:00 AM server time
    cron.schedule('0 8 * * *', async () => {
        console.log('[Reminder Cron] Running daily announcement reminder check...');

        try {
            // Define "tomorrow" as the full 24-hour window
            const now = new Date();
            const tomorrowStart = new Date(now);
            tomorrowStart.setDate(tomorrowStart.getDate() + 1);
            tomorrowStart.setHours(0, 0, 0, 0);

            const tomorrowEnd = new Date(tomorrowStart);
            tomorrowEnd.setHours(23, 59, 59, 999);

            // Find all announcements due tomorrow
            const upcoming = await Announcement.find({
                dueDate: { $gte: tomorrowStart, $lte: tomorrowEnd }
            }).lean();

            if (upcoming.length === 0) {
                console.log('[Reminder Cron] No announcements due tomorrow.');
                return;
            }

            // Group announcements by classId so we send one batch notification per class
            const byClass = {};
            for (const ann of upcoming) {
                const cId = String(ann.classId);
                if (!byClass[cId]) byClass[cId] = [];
                byClass[cId].push(ann);
            }

            // Send a reminder push for each class
            for (const [classId, anns] of Object.entries(byClass)) {
                const titles = anns.map(a => a.title);
                const body = titles.length === 1
                    ? `"${titles[0]}" is due tomorrow!`
                    : `${titles.length} tasks due tomorrow — don't forget!`;

                await sendPushToClass(classId, {
                    title: '⏰ Reminder: Due Tomorrow',
                    body,
                    // Send each subscriber to their attention (announcements) page
                    urlBuilder: (sub) => sub.rollNumber
                        ? `/student/${sub.classId}/${sub.rollNumber}/attention`
                        : '/'
                });

                console.log(`[Reminder Cron] Sent reminder for class ${classId}: ${titles.join(', ')}`);
            }
        } catch (err) {
            console.error('[Reminder Cron] Error sending reminders:', err);
        }
    });

    console.log('[Reminder Cron] Scheduled — runs daily at 8:00 AM');
};

module.exports = { startReminderCron };
