const nodemailer = require('nodemailer');

// ─── Transporter Configuration ───
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

/**
 * Send an account activation email to a student.
 *
 * @param {string} toEmail - Student's email address
 * @param {string} token   - Activation token string
 * @param {object} meta    - Optional metadata (rollNumber, className)
 */
const sendActivationEmail = async (toEmail, token, meta = {}) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const activationLink = `${frontendUrl}/activate?token=${token}`;

    const mailOptions = {
        from: `"Shadow Attendance" <${process.env.SMTP_USER}>`,
        to: toEmail,
        subject: 'Activate Your Shadow Attendance Account',
        html: `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
                <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px; text-align: center;">
                    <h1 style="margin: 0; font-size: 28px; color: #ffffff;">Shadow Attendance</h1>
                    <p style="margin: 8px 0 0; color: #e0e7ff; font-size: 14px;">Account Activation</p>
                </div>
                <div style="padding: 32px;">
                    <p style="font-size: 16px; line-height: 1.6;">Hi there${meta.rollNumber ? ` (${meta.rollNumber})` : ''},</p>
                    <p style="font-size: 16px; line-height: 1.6;">
                        Your attendance account${meta.className ? ` for <strong>${meta.className}</strong>` : ''} is ready to be claimed.
                        Click the button below to set your password and activate your account.
                    </p>
                    <div style="text-align: center; margin: 32px 0;">
                        <a href="${activationLink}"
                           style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-size: 16px; font-weight: 600;">
                            Activate My Account
                        </a>
                    </div>
                    <p style="font-size: 13px; color: #94a3b8; line-height: 1.5;">
                        This link expires in <strong>24 hours</strong>. If you did not expect this email, you can safely ignore it.
                    </p>
                    <hr style="border: none; border-top: 1px solid #1e293b; margin: 24px 0;" />
                    <p style="font-size: 12px; color: #64748b;">
                        Can't click the button? Copy this link:<br/>
                        <a href="${activationLink}" style="color: #818cf8; word-break: break-all;">${activationLink}</a>
                    </p>
                </div>
            </div>
        `
    };

    await transporter.sendMail(mailOptions);
};

module.exports = { sendActivationEmail, transporter };
