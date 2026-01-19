const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');


router.post('/mark', async (req, res) => {
  try {
    const { classId, date, periods } = req.body;

    if (!classId || !date || !periods) {
      return res.status(400).json({ error: 'Missing required fields' });
    }


    const updatedRecord = await Attendance.findOneAndUpdate(
      { classId: classId, date: date }, 
      { $set: { periods: periods } },   
      { new: true, upsert: true }       
    );

    res.json({ message: 'Attendance Saved Successfully!', data: updatedRecord });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
});


router.get('/:classId/:date', async (req, res) => {
  try {
    const { classId, date } = req.params;
    const record = await Attendance.findOne({ classId, date });
    

    res.json(record || null);
    
  } catch (err) {
    res.status(500).json({ error: 'Server Error' });
  }
});

module.exports = router;