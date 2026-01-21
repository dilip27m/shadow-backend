const mongoose = require('mongoose');
require('dotenv').config();

const Attendance = require('./models/Attendance');

async function checkAll() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const allRecords = await Attendance.find({}).sort({ date: -1 });
        console.log(`\nTotal attendance records: ${allRecords.length}\n`);

        allRecords.forEach(record => {
            console.log(`Date: ${record.date.toISOString().split('T')[0]}`);
            console.log(`  Periods: ${record.periods.length}`);
            if (record.periods.length > 0) {
                record.periods.forEach(p => {
                    console.log(`    P${p.periodNum}: ${p.subjectName} - Absent: [${p.absentRollNumbers.join(', ')}]`);
                });
            }
            console.log('');
        });

        await mongoose.connection.close();
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkAll();
