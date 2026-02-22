#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!uri) {
    console.error('Missing MongoDB URI. Set MONGODB_URI or MONGO_URI.');
    process.exit(1);
}

async function run() {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const db = mongoose.connection.db;

    const results = {};

    results.attendanceLatest = await db
        .collection('attendances')
        .createIndex({ classId: 1, updatedAt: -1 }, { name: 'classId_1_updatedAt_-1' });

    results.attendanceHistory = await db
        .collection('attendances')
        .createIndex({ classId: 1, 'periods.subjectId': 1, date: -1 }, { name: 'classId_1_periods.subjectId_1_date_-1' });

    results.reportAdminFeed = await db
        .collection('reports')
        .createIndex({ classId: 1, createdAt: -1 }, { name: 'classId_1_createdAt_-1' });

    results.announcementFeed = await db
        .collection('announcements')
        .createIndex({ classId: 1, createdAt: -1 }, { name: 'classId_1_createdAt_-1' });

    console.log(JSON.stringify(results, null, 2));
    await mongoose.disconnect();
}

run().catch(async (err) => {
    console.error('Index creation failed:', err.message);
    if (mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
    }
    process.exit(1);
});
