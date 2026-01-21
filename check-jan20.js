const mongoose = require('mongoose');
require('dotenv').config();

const Attendance = require('./models/Attendance');

async function checkJan20() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB\n');

        const jan20 = new Date('2026-01-20T00:00:00.000Z');

        const records = await Attendance.find({ date: jan20 });
        console.log(`Found ${records.length} records for Jan 20, 2026:\n`);

        records.forEach((record, idx) => {
            console.log(`Record ${idx + 1}:`);
            console.log(`  _id: ${record._id}`);
            console.log(`  classId: ${record.classId}`);
            console.log(`  date: ${record.date}`);
            console.log(`  Periods: ${record.periods.length}`);
            record.periods.forEach(p => {
                console.log(`    P${p.periodNum}: ${p.subjectName || '(no name)'} - Absent: [${p.absentRollNumbers.join(', ')}]`);
            });
            console.log('');
        });

        await mongoose.connection.close();
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkJan20();
