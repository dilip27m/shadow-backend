/**
 * Migration Script: Backfill StudentRecord from existing Attendance data
 * 
 * Run this ONCE after deploying the new StudentRecord model.
 * It reads all Attendance documents and creates/updates StudentRecord
 * for every student in every class.
 * 
 * Usage: node scripts/migrateStudentRecords.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Classroom = require('../models/Classroom');
const StudentRecord = require('../models/StudentRecord');

const sanitizeRollNumber = (value) => {
    if (value === undefined || value === null) return null;
    const cleaned = String(value).trim();
    return cleaned || null;
};

async function migrate() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        // Get all classes
        const classes = await Classroom.find({}).select('_id className rollNumbers subjects').lean();
        console.log(`📦 Found ${classes.length} class(es) to migrate\n`);

        let totalStudents = 0;
        let totalDays = 0;

        for (const cls of classes) {
            const classId = cls._id;
            const className = cls.className;
            const rollNumbers = (cls.rollNumbers || [])
                .map(r => sanitizeRollNumber(r))
                .filter(Boolean);

            if (rollNumbers.length === 0) {
                console.log(`⏭️  ${className}: No students, skipping`);
                continue;
            }

            // Get all attendance records for this class, sorted by date
            const attendanceRecords = await Attendance.find({ classId })
                .sort({ date: 1 })
                .lean();

            console.log(`📚 ${className}: ${rollNumbers.length} students, ${attendanceRecords.length} attendance records`);

            if (attendanceRecords.length === 0) {
                console.log(`   No attendance data, skipping\n`);
                continue;
            }

            // Build subject name map from class
            const subjectMap = {};
            (cls.subjects || []).forEach(s => {
                subjectMap[s._id.toString()] = s.name;
            });

            // Build StudentRecord data for each student
            const studentData = {}; // rollNumber -> { dayLog: [], subjects: {} }

            for (const roll of rollNumbers) {
                studentData[roll] = {
                    dayLog: [],
                    subjectStats: {} // subjectId -> { total, attended }
                };
            }

            // Process each attendance record
            for (const record of attendanceRecords) {
                const periods = record.periods || [];
                if (periods.length === 0) continue;

                // Build absent sets per period
                const absentSets = periods.map(p => new Set(p.absentRollNumbers || []));

                for (const roll of rollNumbers) {
                    const dayLogEntry = {
                        date: record.date,
                        periods: periods.map((p, i) => {
                            const status = absentSets[i].has(roll) ? 'Absent' : 'Present';

                            // Update subject stats
                            if (p.subjectId) {
                                if (!studentData[roll].subjectStats[p.subjectId]) {
                                    studentData[roll].subjectStats[p.subjectId] = {
                                        subjectId: p.subjectId,
                                        subjectName: p.subjectName || subjectMap[p.subjectId] || '',
                                        totalClasses: 0,
                                        attendedClasses: 0
                                    };
                                }
                                studentData[roll].subjectStats[p.subjectId].totalClasses += 1;
                                if (status === 'Present') {
                                    studentData[roll].subjectStats[p.subjectId].attendedClasses += 1;
                                }
                            }

                            return {
                                periodNum: p.periodNum,
                                subjectId: p.subjectId,
                                subjectName: p.subjectName,
                                status
                            };
                        })
                    };

                    studentData[roll].dayLog.push(dayLogEntry);
                }

                totalDays++;
            }

            // Upsert all StudentRecords for this class
            const bulkOps = rollNumbers.map(roll => ({
                updateOne: {
                    filter: { classId, rollNumber: roll },
                    update: {
                        $set: {
                            classId,
                            rollNumber: roll,
                            subjects: Object.values(studentData[roll].subjectStats),
                            dayLog: studentData[roll].dayLog,
                            lastSyncedAt: new Date()
                        }
                    },
                    upsert: true
                }
            }));

            await StudentRecord.bulkWrite(bulkOps);
            totalStudents += rollNumbers.length;
            console.log(`   ✅ Migrated ${rollNumbers.length} student records\n`);
        }

        console.log('═══════════════════════════════════');
        console.log(`✅ Migration complete!`);
        console.log(`   Students: ${totalStudents}`);
        console.log(`   Attendance days processed: ${totalDays}`);
        console.log('═══════════════════════════════════');

    } catch (err) {
        console.error('❌ Migration failed:', err);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

migrate();
