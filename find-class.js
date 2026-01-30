const mongoose = require('mongoose');
const Classroom = require('./models/Classroom');
require('dotenv').config();

const findClass = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        // Find class "3a" (case insensitive)
        const classroom = await Classroom.findOne({
            className: { $regex: new RegExp('3a', 'i') }
        });

        if (!classroom) {
            console.log('Class "3a" not found.');
        } else {
            console.log(`Found Class: ${classroom.className}`);
            console.log(`Class ID: ${classroom._id}`);
            // Note: We cannot show the password because it is hashed.
        }

        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

findClass();
