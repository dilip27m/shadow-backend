const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const classRoutes = require('./routes/classRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const studentRoutes = require('./routes/studentRoutes');
const reportRoutes = require('./routes/reportRoutes');
const announcementRoutes = require('./routes/announcementRoutes');

const app = express();

// ─── CORS — must come before Helmet ───
// ─── CORS — must come before Helmet ───
const corsOptions = {
    origin: true, // Reflects the request origin, allowing any origin
    credentials: true, // Required for cookies/authorization headers
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions)); // Handle preflight for all routes

// ─── Security Headers ───
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false, // Allow inline scripts for Next.js
}));

// ─── Logging (skip in test) ───
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ─── Compression ───
app.use(compression());

// ─── Body Parser ───
app.use(express.json({ limit: '1mb' }));

// ─── Rate Limiting ───
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // Increased for admin usage patterns (many API calls per page)
    message: { error: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// ─── Response Caching Headers ───
// ─── Response Caching Headers ───
// Force no-cache for all API responses to ensure real-time updates
app.use((req, res, next) => {
    if (req.method === 'GET') {
        // Allow short-term caching (e.g., 1 minute) for student reports
        res.set('Cache-Control', 'public, max-age=60');
    } else {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    }
    next();
});

// ─── DB Connection ───
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI, {
            maxPoolSize: 10, // Limit to 10 to stay within Free Tier limits
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        console.log('MongoDB Connected (Pool Limited to 10)');
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

connectDB();

// ─── Routes ───
app.use('/api/class', classRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/announcements', announcementRoutes);

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Shadow API is running' });
});

// ─── 404 handler ───
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// ─── Global error handler ───
app.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
    });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, '0.0.0.0', () => { // Binding to 0.0.0.0 is best for cloud deploys
    console.log(`Server running on port ${PORT}`);
});