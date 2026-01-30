const mongoose = require('mongoose');
const Teacher = require('./models/Teacher');
const Classroom = require('./models/Classroom');
require('dotenv').config();

const cleanInvalidAssignments = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to DB...");

        const teachers = await Teacher.find({});

        for (const teacher of teachers) {
            let modified = false;
            const validAssignments = [];

            for (const assignment of teacher.assignedClasses) {
                // Check if Class exists
                const classroom = await Classroom.findById(assignment.classId);
                if (!classroom) {
                    console.log(`[found invalid] Teacher: ${teacher.name} | Invalid Class ID: ${assignment.classId}`);
                    modified = true;
                    // We skip adding it to validAssignments, effectively deleting it
                } else {
                    // Check if Subject exists (optional but good)
                    const subject = classroom.subjects.id(assignment.subjectId);
                    if (!subject) {
                        console.log(`[found invalid] Teacher: ${teacher.name} | Class: ${classroom.className} | Invalid Subject ID`);
                        modified = true;
                    } else {
                        validAssignments.push(assignment);
                    }
                }
            }

            if (modified) {
                teacher.assignedClasses = validAssignments;
                await teacher.save();
                console.log(`Cleaned assignments for ${teacher.name}`);
            }
        }

        console.log("Done.");
        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

cleanInvalidAssignments();
