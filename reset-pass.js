const mongoose = require('mongoose');
const Teacher = require('./models/Teacher');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const resetPass = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash('123456', salt);

        // Find the teacher we saw in the logs (or just the first one)
        const teacher = await Teacher.findOne({ email: 'teacher@test.com' });
        if (teacher) {
            teacher.password = hash;
            await teacher.save();
            console.log("Password reset for teacher@test.com");
        } else {
            console.log("teacher@test.com not found, trying first teacher...");
            const first = await Teacher.findOne({});
            if (first) {
                first.password = hash;
                await first.save();
                console.log(`Password reset for ${first.email}`);
            }
        }
        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

resetPass();
