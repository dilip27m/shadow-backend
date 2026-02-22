const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Teacher = require('./models/Teacher');
const Classroom = require('./models/Classroom');
require('dotenv').config();

const createTeacher = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected');

        // 1. Find the first classroom
        const classroom = await Classroom.findOne();
        if (!classroom) {
            console.log('No classrooms found! Create a class first.');
            process.exit(1);
        }

        console.log(`Found Class: ${classroom.className}`);

        // 2. Find a subject to assign
        if (classroom.subjects.length === 0) {
            console.log('No subjects in this class.');
            process.exit(1);
        }
        const subject = classroom.subjects[0];
        console.log(`Assigning Subject: ${subject.name}`);

        // 3. Create Teacher
        // Check if already exists
        let teacher = await Teacher.findOne({ email: 'teacher@test.com' });
        if (teacher) {
            console.log('Teacher already exists. Updating assignment.');
            // Update assignment if needed
            const isAssigned = teacher.assignedClasses.some(a => a.classId.toString() === classroom._id.toString() && a.subjectId.toString() === subject._id.toString());
            if (!isAssigned) {
                teacher.assignedClasses.push({
                    classId: classroom._id,
                    subjectId: subject._id
                });
                await teacher.save();
            }
        } else {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('password123', salt);

            teacher = new Teacher({
                name: 'John Doe',
                email: 'teacher@test.com',
                password: hashedPassword,
                teacherCode: '123456',
                assignedClasses: [{
                    classId: classroom._id,
                    subjectId: subject._id
                }]
            });
            await teacher.save();
            console.log('Teacher Created!');
        }

        console.log('Email: teacher@test.com');
        console.log('Password: password123');
        console.log('Teacher Code: 123456');

        // 4. Update Classroom Subject with Teacher ID
        const subjectIndex = classroom.subjects.findIndex(s => s._id.toString() === subject._id.toString());
        if (subjectIndex !== -1) {
            classroom.subjects[subjectIndex].teacherId = teacher._id;
            await classroom.save();
            console.log('Classroom Subject updated with Teacher ID');
        }

        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

createTeacher();
