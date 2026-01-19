const express = require('express');
const router = express.Router();
const Classroom = require('../models/Classroom');


router.post('/create', async (req, res) => {
  try {
    const { className, adminPin, totalStudents, subjects, timetable } = req.body;


    if (!className || !adminPin || !totalStudents) {
      return res.status(400).json({ error: 'Please provide all required fields' });
    }

    const newClass = new Classroom({
      className,
      adminPin,
      totalStudents,
      subjects, 
      timetable
    });

    const savedClass = await newClass.save();

    res.status(201).json({ 
      message: 'Class Created!', 
      classId: savedClass._id, 
      data: savedClass 
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server Error' });
  }
});


router.get('/:id', async (req, res) => {
  try {
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Class not found' });
    res.json(classroom);
  } catch (err) {
    res.status(500).json({ error: 'Server Error' });
  }
});

module.exports = router;