const mongoose = require('mongoose');
const Teacher = require('./models/Teacher');
const Classroom = require('./models/Classroom');
require('dotenv').config();

const debugTeacher = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        const teachers = await Teacher.find({});
        console.log(`Found ${teachers.length} teachers.`);

        for (const t of teachers) {
            console.log(`\nTeacher: ${t.name} (${t.email})`);
            console.log(`Assigned Classes: ${t.assignedClasses.length}`);

            for (const a of t.assignedClasses) {
                console.log(` - ClassRef: ${a.classId} | SubjectID: ${a.subjectId}`);

                const c = await Classroom.findById(a.classId);
                if (c) {
                    console.log(`   -> Class Found: ${c.className}`);
                    const s = c.subjects.id(a.subjectId);
                    if (s) {
                        console.log(`   -> Subject Found: ${s.name} | Status: ${s.teacherStatus} | TeacherID: ${s.teacherId}`);
                    } else {
                        console.log(`   -> SUBJECT NOT FOUND in Class`);
                    }
                } else {
                    console.log(`   -> CLASS NOT FOUND`);
                }
            }
        }

        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

debugTeacher();
