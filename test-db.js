require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGO_URI;

if (!uri) {
    console.error('Error: MONGO_URI is not defined in .env file');
    process.exit(1);
}

console.log('Attempting to connect to MongoDB...');
// Basic masking for log security, assumes standard URI format
const maskedUri = uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
console.log(`Connecting to: ${maskedUri}`);

mongoose.connect(uri)
    .then(() => {
        console.log('✅ Successfully connected to MongoDB!');
        // Optional: Check connection state
        console.log(`Connection State: ${mongoose.connection.readyState} (1 = connected)`);
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ Connection error:', err.message);
        if (err.message.includes('bad auth') || err.code === 8000) {
            console.error('\n⚠️  POSSIBLE CAUSE: Authentication failed.');
            console.error('   Please check the password in your .env file.');
            console.error('   Ensure <db_password> is replaced with the actual password.');
        } else if (err.codeName === 'AtlasError') {
            console.error('\n⚠️  POSSIBLE CAUSE: Atlas/Network error. Check IP whitelisting.');
        }
        process.exit(1);
    });
