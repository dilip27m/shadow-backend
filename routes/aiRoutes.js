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

        const apiKeyString = process.env.GEMINI_API_KEY;
        if (!apiKeyString) {
            return res.status(500).json({ error: 'AI features are not configured on this server.' });
        }

        const apiKeys = apiKeyString.split(',').map(key => key.trim()).filter(key => key.length > 0);
        if (apiKeys.length === 0) {
            return res.status(500).json({ error: 'No valid AI API keys found.' });
        }

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

        let result = null;
        let lastError = null;

        for (const key of apiKeys) {
            try {
                const genAI = new GoogleGenerativeAI(key);
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                result = await model.generateContent([prompt, imagePart]);
                break; // Success, exit loop
            } catch (error) {
                console.warn('AI key failed, trying next one if available...', error.message);
                lastError = error;
            }
        }

        if (!result) {
            const errMsg = lastError?.message || "";
            if (errMsg.includes("429") || errMsg.includes("quota")) {
                throw new Error("Camera feature is disabled for today, please try again later.");
            }
            throw lastError || new Error("All provided Gemini API keys failed.");
        }
        const responseText = result.response.text();

        // Extract numbers explicitly to clean up any extra text
        const numbersMatch = responseText.match(/\d+/g);
        const rollNumbersString = numbersMatch ? numbersMatch.join(', ') : '';

        res.json({ rollNumbers: rollNumbersString });
    } catch (error) {
        console.error('AI Error:', error);
        res.status(500).json({ error: 'Failed to process image', details: error.message || 'Unknown AI error occurred.' });
    }
});

// Scan department LOGBOOK app screenshot (color-coded grid: green=present, red=absent, yellow=late)
router.post('/scan-logbook-app', auth, async (req, res) => {
    try {
        if (!requireAdminAuth(req, res)) return;
        const { imageBase64 } = req.body;
        if (!imageBase64) {
            return res.status(400).json({ error: 'No image provided' });
        }

        const apiKeyString = process.env.GEMINI_API_KEY;
        if (!apiKeyString) {
            return res.status(500).json({ error: 'AI features are not configured on this server.' });
        }

        const apiKeys = apiKeyString.split(',').map(key => key.trim()).filter(key => key.length > 0);
        if (apiKeys.length === 0) {
            return res.status(500).json({ error: 'No valid AI API keys found.' });
        }

        // Extract actual MIME type from the base64 string
        const mimeTypeMatch = imageBase64.match(/^data:([^;]+);base64,/);
        const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/jpeg";
        const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, "");

        const prompt = `You are an attendance parser for a LOGBOOK application screenshot.

The image shows a grid/table of colored cells. Each cell contains:
- A LARGE, PROMINENT number (this is the roll number — the ONLY number you should extract)
- Small text above or near it (like "AIE23", "CSE22", dates, etc.) — COMPLETELY IGNORE all small text and small numbers

HOW TO IDENTIFY ROLL NUMBERS:
- Roll numbers are displayed in a SIGNIFICANTLY BIGGER font size compared to everything else in the image
- They are the main/central number inside each colored cell
- Any other numbers (dates, batch codes, section numbers, navigation elements, header text) will be in a much smaller font — IGNORE them entirely

Each cell has a background color indicating attendance status:
  - GREEN background = Present
  - RED background = Absent
  - YELLOW or ORANGE background = Late comer

ROLL NUMBER FORMAT:
The roll numbers shown are 3-digit numbers where the HUNDREDS digit is a section code and must be REMOVED.
Only keep the LAST TWO digits and drop leading zeros.
Examples: 101 → 1, 113 → 13, 207 → 7, 231 → 31, 103 → 3

Return your answer as valid JSON with this exact format (no markdown, no code fences, just raw JSON):
{"absent": [2, 5], "late": [3, 25]}

Rules:
- ONLY extract the large, prominent numbers from inside the colored grid cells
- IGNORE all other text and numbers in the image (headers, dates, batch codes, navigation, buttons, etc.)
- Only include roll numbers from RED cells in the "absent" array
- Only include roll numbers from YELLOW/ORANGE cells in the "late" array
- Do NOT include GREEN (present) roll numbers in the output
- If there are no absent students, return {"absent": [], "late": []}
- If there are no late students, return {"absent": [...], "late": []}`;

        const imagePart = {
            inlineData: {
                data: base64Data,
                mimeType: mimeType
            },
        };

        let result = null;
        let lastError = null;

        for (const key of apiKeys) {
            try {
                const genAI = new GoogleGenerativeAI(key);
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                result = await model.generateContent([prompt, imagePart]);
                break;
            } catch (error) {
                console.warn('AI key failed, trying next one if available...', error.message);
                lastError = error;
            }
        }

        if (!result) {
            const errMsg = lastError?.message || "";
            if (errMsg.includes("429") || errMsg.includes("quota")) {
                throw new Error("Camera feature is disabled for today, please try again later.");
            }
            throw lastError || new Error("All provided Gemini API keys failed.");
        }

        const responseText = result.response.text();

        // Parse the JSON response from Gemini
        let parsed;
        try {
            // Clean up response — remove markdown code fences if present
            const cleanedText = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            parsed = JSON.parse(cleanedText);
        } catch (parseErr) {
            console.error('Failed to parse AI response as JSON:', responseText);
            // Fallback: try to extract numbers from the response
            const numbersMatch = responseText.match(/\d+/g);
            const rollNumbersString = numbersMatch ? numbersMatch.join(', ') : '';
            return res.json({ absent: rollNumbersString, late: '' });
        }

        const absentRolls = (parsed.absent || []).map(r => String(r));
        const lateRolls = (parsed.late || []).map(r => String(r));

        res.json({
            absent: absentRolls.join(', '),
            late: lateRolls.join(', ')
        });
    } catch (error) {
        console.error('AI Error (logbook-app):', error);
        res.status(500).json({ error: 'Failed to process image', details: error.message || 'Unknown AI error occurred.' });
    }
});

module.exports = router;
