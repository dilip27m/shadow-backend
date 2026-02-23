const express = require('express');
const router = express.Router();
const Announcement = require('../models/Announcement');
const auth = require('../middleware/auth');
const { sendPushToClass } = require('../utils/pushService');

const requireAdminAuth = (req, res) => {
    if (req.user?.role === 'student') {
        res.status(403).json({ error: 'Admin authentication required' });
        return false;
    }
    return true;
};

// Get all announcements for a class (Public - students need access)
router.get('/:classId', async (req, res) => {
    try {
        // Announcements are time-sensitive; always bypass browser/proxy caches.
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        const announcements = await Announcement.find({ classId: req.params.classId })
            .sort({ createdAt: -1 })
            .limit(100).lean();
        res.json({ announcements });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Create new announcement (Protected - admin only)
router.post('/', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const { classId, title, description, subjectId, subjectName, dueDate } = req.body;

        if (!title) {
            return res.status(400).json({ error: 'title is required' });
        }

        if (classId && classId !== req.user.classId) {
            return res.status(403).json({ error: 'Unauthorized action for this class' });
        }

        // Compute expiry: 6 days after due date
        let expiresAt = null;
        if (dueDate) {
            expiresAt = new Date(new Date(dueDate).getTime() + 6 * 24 * 60 * 60 * 1000);
        }

        const announcement = new Announcement({
            classId: req.user.classId,
            title: title.trim(),
            description: (description || '').trim(),
            subjectId: subjectId || null,
            subjectName: subjectName || 'General',
            dueDate: dueDate || null,
            expiresAt
        });

        await announcement.save();
        res.status(201).json(announcement);

        // Send push notification (non-blocking)
        sendPushToClass(req.user.classId, {
            title: `📢 New Announcement`,
            body: announcement.title,
            url: '/'
        }).catch(() => { });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Update announcement (Protected - admin only)
router.patch('/:id', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const { title, description, subjectId, subjectName, dueDate } = req.body;

        const announcement = await Announcement.findById(req.params.id);
        if (!announcement) return res.status(404).json({ error: 'Announcement not found' });

        if (announcement.classId.toString() !== req.user.classId) {
            return res.status(403).json({ error: 'Unauthorized action for this class' });
        }

        // Update fields
        if (title) announcement.title = title.trim();
        if (description !== undefined) announcement.description = (description || '').trim();
        if (subjectId !== undefined) announcement.subjectId = subjectId || null;
        if (subjectName !== undefined) announcement.subjectName = subjectName || 'General';
        if (dueDate !== undefined) {
            announcement.dueDate = dueDate || null;
            // Recompute expiry when due date changes
            if (dueDate) {
                announcement.expiresAt = new Date(new Date(dueDate).getTime() + 6 * 24 * 60 * 60 * 1000);
            } else {
                announcement.expiresAt = null;
            }
        }

        await announcement.save();
        res.json(announcement);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Delete announcement (Protected - admin only)
router.delete('/:id', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const announcement = await Announcement.findById(req.params.id);
        if (!announcement) return res.status(404).json({ error: 'Announcement not found' });

        if (announcement.classId.toString() !== req.user.classId) {
            return res.status(403).json({ error: 'Unauthorized action for this class' });
        }

        await Announcement.findByIdAndDelete(req.params.id);
        res.json({ message: 'Announcement deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;
