const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const requireAdminAuth = (req, res) => {
    if (req.user?.role === 'student') {
        res.status(403).json({ error: 'Admin authentication required' });
        return false;
    }
    return true;
};

router.post('/scan-logbook', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const { imageBase64 } = req.body;
        if (!imageBase64) {
            return res.status(400).json({ error: 'No image provided' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'AI features are not configured on this server.' });
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        // Extract actual MIME type from the base64 string
        const mimeTypeMatch = imageBase64.match(/^data:([^;]+);base64,/);
        const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/jpeg";
        const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, "");

        const prompt = "You are an attendance parser. Look at the attached image of a handwritten logbook. Extract all the numbers you see that look like roll numbers. Return ONLY a comma-separated list of those numbers (e.g., '1, 14, 23'). Do not include names, text, or any other explanations. If you see no numbers, return an empty string.";

        const imagePart = {
            inlineData: {
                data: base64Data,
                mimeType: mimeType
            },
        };

        const result = await model.generateContent([prompt, imagePart]);
        const responseText = result.response.text();

        // Extract numbers explicitly to clean up any extra text
        const numbersMatch = responseText.match(/\d+/g);
        const rollNumbersString = numbersMatch ? numbersMatch.join(', ') : '';

        res.json({ rollNumbers: rollNumbersString });
    } catch (error) {
        console.error('AI Error:', error);
        res.status(500).json({ error: 'Failed to process image', details: error.message || error.toString() });
    }
});

module.exports = router;
