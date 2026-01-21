const mongoose = require('mongoose');
require('dotenv').config();

const Attendance = require('./models/Attendance');

async function checkAttendance() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        // Find attendance for Jan 13 and Jan 20
        const jan13 = new Date('2026-01-13T00:00:00');
        const jan20 = new Date('2026-01-20T00:00:00');

        console.log('\n=== JAN 13, 2026 ===');
        const record13 = await Attendance.findOne({ date: jan13 });
        if (record13) {
            console.log('Found record for Jan 13');
            console.log('Periods count:', record13.periods.length);
            record13.periods.forEach((p, idx) => {
                console.log(`  Period ${p.periodNum}: ${p.subjectName}`);
                console.log(`    Absent rolls: [${p.absentRollNumbers.join(', ')}]`);
                console.log(`    Is roll 3 absent? ${p.absentRollNumbers.includes(3)}`);
            });
        } else {
            console.log('NO RECORD FOUND for Jan 13');
        }

        console.log('\n=== JAN 20, 2026 ===');
        const record20 = await Attendance.findOne({ date: jan20 });
        if (record20) {
            console.log('Found record for Jan 20');
            console.log('Periods count:', record20.periods.length);
            record20.periods.forEach((p, idx) => {
                console.log(`  Period ${p.periodNum}: ${p.subjectName}`);
                console.log(`    Absent rolls: [${p.absentRollNumbers.join(', ')}]`);
                console.log(`    Is roll 3 absent? ${p.absentRollNumbers.includes(3)}`);
            });
        } else {
            console.log('NO RECORD FOUND for Jan 20');
        }

        await mongoose.connection.close();
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkAttendance();
