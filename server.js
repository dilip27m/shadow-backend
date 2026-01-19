const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();


const classRoutes = require('./routes/classRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const studentRoutes = require('./routes/studentRoutes');


const app = express();


app.use(express.json());
app.use(cors());        


const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB Connected:");
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1); 
  }
};

connectDB();


app.use('/api/class', classRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/student', studentRoutes);


app.get('/', (req, res) => {
  res.send('API is running');
});


const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(` Server running on port ${PORT}`);
});