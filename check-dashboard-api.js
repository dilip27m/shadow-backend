const axios = require('axios');
require('dotenv').config();

const checkApi = async () => {
    try {
        // 1. Login
        const loginRes = await axios.post('http://localhost:5000/api/teacher/login', {
            email: 'teacher@test.com',
            password: '123456'
        });

        console.log("Login Success. Token:", loginRes.data.token ? "YES" : "NO");
        const token = loginRes.data.token;

        // 2. Get Dashboard
        const dashRes = await axios.get('http://localhost:5000/api/teacher/dashboard', {
            headers: { 'x-auth-token': token }
        });

        console.log("Dashboard Status:", dashRes.status);
        console.log("Teacher Name:", dashRes.data.name);
        console.log("Assigned Classes (Raw):");
        console.log(JSON.stringify(dashRes.data.assignedClasses, null, 2));

    } catch (err) {
        if (err.response) {
            console.error("API Error:", err.response.status, err.response.data);
        } else {
            console.error("Error:", err.message);
        }
    }
};

checkApi();
