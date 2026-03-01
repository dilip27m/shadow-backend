const crypto = require('crypto');
const ActivationToken = require('../models/ActivationToken');

const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generate a unique activation token for a student and persist it.
 *
 * @param {string} studentId - The Student document's _id
 * @returns {Promise<string>} The raw token string (to be sent via email)
 */
const generateActivationToken = async (studentId) => {
    // Remove any previous tokens for this student (only one active at a time)
    await ActivationToken.deleteMany({ studentId });

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);

    await ActivationToken.create({ token, studentId, expiresAt });

    return token;
};

/**
 * Validate a token string and return the associated document (with studentId).
 * Returns null if expired or not found.
 *
 * @param {string} tokenString
 * @returns {Promise<object|null>}
 */
const validateActivationToken = async (tokenString) => {
    const tokenDoc = await ActivationToken.findOne({
        token: tokenString,
        expiresAt: { $gt: new Date() }
    }).lean();

    return tokenDoc || null;
};

/**
 * Consume (delete) a token after successful activation.
 *
 * @param {string} tokenString
 */
const consumeActivationToken = async (tokenString) => {
    await ActivationToken.deleteOne({ token: tokenString });
};

module.exports = {
    generateActivationToken,
    validateActivationToken,
    consumeActivationToken
};
