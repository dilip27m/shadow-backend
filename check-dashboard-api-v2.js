require('dotenv').config();

const checkApi = async () => {
    try {
        // 1. Login
        const loginRes = await fetch('http://localhost:5000/api/teacher/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'teacher@test.com',
                password: '123456'
            })
        });

        const loginData = await loginRes.json();
        console.log("Login Status:", loginRes.status);
        console.log("Token Present:", loginData.token ? "YES" : "NO");

        if (!loginData.token) return;

        // 2. Get Dashboard
        const dashRes = await fetch('http://localhost:5000/api/teacher/dashboard', {
            headers: { 'x-auth-token': loginData.token }
        });

        const dashData = await dashRes.json();
        console.log("Dashboard Status:", dashRes.status);
        console.log("Teacher Name:", dashData.name);
        console.log("Assigned Classes (Raw):");
        console.log(JSON.stringify(dashData.assignedClasses, null, 2));

    } catch (err) {
        console.error("Error:", err);
    }
};

checkApi();
