const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config(); // MUST be at the top

const classRoutes = require('./routes/classRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const studentRoutes = require('./routes/studentRoutes');
const specialDateRoutes = require('./routes/specialDateRoutes');

const app = express();

// Security Middleware
app.use(helmet()); // Adds security headers

// Logging Middleware (only in development and production)
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// Compression Middleware
app.use(compression());

// Body Parser
app.use(express.json());

// CORS Configuration
const corsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// DB Connection
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI);
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

connectDB();

// Routes
app.use('/api/class', classRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/special-dates', specialDateRoutes);

app.get('/', (req, res) => {
    res.send('Shadow API is running...');
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});