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
const aiRoutes = require('./routes/aiRoutes');

const app = express();

// ─── CORS — must come before Helmet ───
// ─── CORS — must come before Helmet ───
const corsOptions = {
    origin: true, // Reflects the request origin, allowing any origin
    credentials: true, // Required for cookies/authorization headers
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ─── Rate Limiting ───
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 2000, // Drastically increased for heavy local testing to prevent blocks
    message: { error: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// ─── Response Caching Headers ───
// Keep caching only for safe aggregate stats; serve live data everywhere else.
app.use((req, res, next) => {
    const isStatsRoute = req.method === 'GET' && (
        req.path === '/api/class/stats/all' || req.path === '/api/classes/stats/all'
    );
    if (isStatsRoute) {
        res.set('Cache-Control', 'public, max-age=60');
    } else {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    }
    next();
});

// ─── DB Connection ───
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!mongoUri) {
    console.error('MongoDB URI is missing. Set MONGODB_URI or MONGO_URI.');
    process.exit(1);
}

mongoose.connect(mongoUri, {
    maxPoolSize: 50, // Increased to 50 for even higher concurrency 
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
    .then(() => console.log('MongoDB Connected (Pool Limited to 50)'))
    .catch(err => console.log(err));

// ─── Routes ───
app.use('/api/class', classRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/ai', aiRoutes);

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
