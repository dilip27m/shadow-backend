const express = require('express');
const router = express.Router();
const SpecialDate = require('../models/SpecialDate');
const auth = require('../middleware/auth');

// Get all special dates for a class (Public for students)
router.get('/:classId', async (req, res) => {
    try {
        const { classId } = req.params;
        const specialDates = await SpecialDate.find({ classId }).sort({ date: 1 });
        res.json({ specialDates });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Create new special date (Protected)
router.post('/', auth, async (req, res) => {
    try {
        const { classId, date, type, title } = req.body;

        // Check if date already exists
        const existing = await SpecialDate.findOne({ classId, date: new Date(date) });
        if (existing) {
            return res.status(400).json({ error: 'Date already marked' });
        }

        const specialDate = new SpecialDate({
            classId,
            date: new Date(date),
            type,
            title
        });

        await specialDate.save();
        res.json({ specialDate });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

// Delete special date (Protected)
router.delete('/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        await SpecialDate.findByIdAndDelete(id);
        res.json({ message: 'Special date deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
});

module.exports = router;
