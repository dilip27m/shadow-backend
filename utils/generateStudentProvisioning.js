/**
 * generateStudentProvisioning(startRoll, endRoll)
 *
 * Generates an array of student provisioning objects with random secret keys.
 * Returns both plain-text keys (for admin distribution) and hashed keys (for DB).
 *
 * @param {string} startRoll - e.g. "21CS001"
 * @param {string} endRoll   - e.g. "21CS060"
 * @returns {Promise<{ rollNumber: string, plainKey: string, hashedKey: string }[]>}
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ROLL_REGEX = /^(.*?)(\d+)$/;
const KEY_LENGTH = 6;
const KEY_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generate a cryptographically random alphanumeric string.
 */
const generateSecretKey = () => {
    const bytes = crypto.randomBytes(KEY_LENGTH);
    let key = '';
    for (let i = 0; i < KEY_LENGTH; i++) {
        key += KEY_CHARS[bytes[i] % KEY_CHARS.length];
    }
    return key;
};

const generateStudentProvisioning = async (startRoll, endRoll) => {
    // ── Validate inputs ──
    if (!startRoll || !endRoll) {
        throw new Error('startRoll and endRoll are required');
    }

    const startMatch = String(startRoll).trim().match(ROLL_REGEX);
    const endMatch = String(endRoll).trim().match(ROLL_REGEX);

    if (!startMatch) {
        throw new Error(`Invalid start roll number format: "${startRoll}". Expected format like "21CS001" or "001".`);
    }
    if (!endMatch) {
        throw new Error(`Invalid end roll number format: "${endRoll}". Expected format like "21CS060" or "060".`);
    }

    const [, startPrefix, startNumStr] = startMatch;
    const [, endPrefix, endNumStr] = endMatch;

    // Prefixes must match
    if (startPrefix.toLowerCase() !== endPrefix.toLowerCase()) {
        throw new Error(
            `Roll number prefix mismatch: "${startPrefix}" vs "${endPrefix}". Both must share the same prefix.`
        );
    }

    const startNum = parseInt(startNumStr, 10);
    const endNum = parseInt(endNumStr, 10);

    if (endNum < startNum) {
        throw new Error(
            `Invalid range: end (${endNum}) cannot be less than start (${startNum}).`
        );
    }

    // Preserve original zero-padding width (e.g. "001" → pad to 3 digits)
    const padWidth = startNumStr.length;
    const prefix = startPrefix; // preserve original casing

    // ── Generate list with secret keys ──
    const students = [];

    for (let i = startNum; i <= endNum; i++) {
        const numPart = String(i).padStart(padWidth, '0');
        const rollNumber = `${prefix}${numPart}`;
        const plainKey = generateSecretKey();
        const hashedKey = await bcrypt.hash(plainKey, 10);

        students.push({ rollNumber, plainKey, hashedKey });
    }

    return students;
};

module.exports = { generateStudentProvisioning, generateSecretKey };
