const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

async function sendCredentialsEmail(toEmail, name, tempPassword, loginUrl) {
  const t = getTransporter();
  if (!t) {
    console.log('Email not configured (SMTP_USER/SMTP_PASS missing). Skipping email.');
    return false;
  }

  try {
    await t.sendMail({
      from: `"DMS System" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: 'Your DMS Account Has Been Created',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px">
          <h2 style="color:#00E5FF">DMS — Delivery Management System</h2>
          <p>Hi ${name},</p>
          <p>Your account has been created. Use the credentials below to log in:</p>
          <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
            <p style="margin:5px 0"><strong>Email:</strong> ${toEmail}</p>
            <p style="margin:5px 0"><strong>Temporary Password:</strong> ${tempPassword}</p>
          </div>
          <p><strong>You will be required to change your password on first login.</strong></p>
          <p><a href="${loginUrl}" style="background:#00E5FF;color:#000;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin:10px 0">Log In Now</a></p>
          <p style="color:#888;font-size:12px;margin-top:20px">This is an automated message from DMS.</p>
        </div>
      `,
    });
    console.log(`Credentials email sent to ${toEmail}`);
    return true;
  } catch (err) {
    console.error('Failed to send email:', err.message);
    return false;
  }
}

module.exports = { sendCredentialsEmail };
