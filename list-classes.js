const mongoose = require('mongoose');
const Classroom = require('./models/Classroom');
require('dotenv').config();

const listClasses = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        const classrooms = await Classroom.find({});
        console.log(`Found ${classrooms.length} classes:`);

        classrooms.forEach(c => {
            console.log(`- Name: "${c.className}" | ID: ${c._id}`);
        });

        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

listClasses();
