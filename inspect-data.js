const mongoose = require('mongoose');
const Teacher = require('./models/Teacher');
const Classroom = require('./models/Classroom');
require('dotenv').config();

const inspectTeachers = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to DB...");

        const teachers = await Teacher.find({});
        console.log(`\n--- TEACHER REPORT (${teachers.length} found) ---`);

        for (const t of teachers) {
            console.log(`\nTeacher: ${t.name}`);
            console.log(`  Email: ${t.email}`);
            console.log(`  Code: ${t.teacherCode}`);
            console.log(`  ID: ${t._id}`);
            console.log(`  Assignments in Teacher Doc: ${t.assignedClasses.length}`);

            for (const a of t.assignedClasses) {
                // Check direct match
                const c = await Classroom.findById(a.classId);
                let status = "CLASS_NOT_FOUND";
                let subjectName = "UNKNOWN";
                let dbStatus = "UNKNOWN";

                if (c) {
                    const s = c.subjects.id(a.subjectId);
                    if (s) {
                        subjectName = s.name;
                        dbStatus = s.teacherStatus;

                        // Verify reverse link
                        if (s.teacherId && s.teacherId.toString() === t._id.toString()) {
                            status = "LINKED_OK";
                        } else {
                            status = `LINK_MISMATCH (Subj points to ${s.teacherId})`;
                        }
                    } else {
                        status = "SUBJ_NOT_FOUND";
                    }
                }

                console.log(`    - Class: ${c?.className || '???'} | Subj: ${subjectName} | Status: ${dbStatus} | Link: ${status}`);
            }
        }
        console.log("\n--- END REPORT ---");
        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

inspectTeachers();
