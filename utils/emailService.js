import nodemailer from 'nodemailer';
import expressRateLimit from 'express-rate-limit';

let transporter;

const getSmtpHost = () => (process.env.SMTP_HOST ? process.env.SMTP_HOST.trim() : '') || 'smtp.gmail.com';
const getSmtpPort = () => parseInt(process.env.SMTP_PORT || '', 10) || 587;
const getEmailUser = () => (process.env.EMAIL_USER ? process.env.EMAIL_USER.trim() : '');
const getEmailPass = () => (process.env.EMAIL_PASSWORD ? process.env.EMAIL_PASSWORD.trim() : '');
const getEmailFrom = () => (process.env.EMAIL_FROM ? process.env.EMAIL_FROM.trim() : '') || getEmailUser();
const isGmailHost = () => getSmtpHost().toLowerCase() === 'smtp.gmail.com';

const buildTransportConfig = (override = {}) => {
  const port = override.port !== undefined ? override.port : getSmtpPort();
  const secure = override.secure !== undefined ? override.secure : port === 465;

  const config = {
    host: getSmtpHost(),
    port,
    secure,
    auth: {
      user: getEmailUser(),
      pass: getEmailPass(),
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    ...override,
  };

  if (config.port === 587) {
    config.requireTLS = true;
  }

  return config;
};

const initializeTransporter = (override = {}) => {
  transporter = nodemailer.createTransport(buildTransportConfig(override));
};

const initializeGmailFallbackTransporter = (override = {}) => {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: getEmailUser(),
      pass: getEmailPass(),
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    tls: {
      rejectUnauthorized: false,
    },
    ...override,
  });
};

// Send pass key email for new staff users
export const sendPassKeyEmail = async (email, passKey, role) => {
  try {
    if (!transporter) {
      initializeTransporter();
    }

    const roleDisplay = role.charAt(0).toUpperCase() + role.slice(1);

    const mailOptions = {
      from: getEmailFrom(),
      to: email,
      subject: `Your MedDec ${roleDisplay} Access Pass Key`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f9ff; border-radius: 8px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h1 style="color: #0c4a7a; margin-bottom: 20px;">Welcome to MedDec</h1>
            
            <p style="color: #556c87; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Hello,
            </p>
            
            <p style="color: #556c87; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              You have been invited to join MedDec as a <strong>${roleDisplay}</strong> staff member. Your account has been created and you can sign in immediately using the pass key below.
            </p>
            
            <div style="background-color: #f0f9ff; border: 2px solid #0d6efd; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
              <p style="color: #0c4a7a; font-size: 14px; margin-bottom: 10px; font-weight: bold;">Your Pass Key:</p>
              <p style="color: #0d6efd; font-size: 18px; font-weight: bold; font-family: 'Courier New', monospace; background-color: #ffffff; padding: 10px; border-radius: 4px; border: 1px solid #e0e7f1;">
                ${passKey}
              </p>
              <p style="color: #8fa9c4; font-size: 12px; margin-top: 10px;">
                Copy and paste this pass key as your password when signing in.
              </p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/signin" style="background-color: #0d6efd; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
                Sign In Now
              </a>
            </div>
            
            <hr style="border: none; border-top: 1px solid #e0e7f1; margin: 20px 0;">
            
            <p style="color: #8fa9c4; font-size: 12px; line-height: 1.6;">
              Please keep this pass key secure. You can change your password after signing in for the first time.
            </p>
            
            <p style="color: #8fa9c4; font-size: 12px; line-height: 1.6; margin-top: 20px;">
              Best regards,<br>
              <strong>MedDec Admin Team</strong>
            </p>
          </div>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Pass key email sent:', info.messageId);
  } catch (error) {
    if (isGmailHost() && error.code === 'ETIMEDOUT' && getSmtpPort() === 587) {
      console.warn('Pass key email timeout on Gmail port 587, retrying with secure fallback...');
      initializeGmailFallbackTransporter();
      const info = await transporter.sendMail(mailOptions);
      console.log('Pass key email sent successfully with Gmail secure fallback:', info.response || info.messageId);
      return;
    }

    if (
      isGmailHost() &&
      (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        (error.message && error.message.includes('unable to verify the first certificate')) ||
        (error.message && error.message.includes('self signed certificate')))
    ) {
      console.warn('Pass key email TLS certificate validation failed, retrying with relaxed TLS verification...');
      initializeGmailFallbackTransporter();
      const info = await transporter.sendMail(mailOptions);
      console.log('Pass key email sent successfully with relaxed TLS verification:', info.response || info.messageId);
      return;
    }

    console.error('Error sending pass key email:', error);
    throw error;
  }
};

// Send password reset email
export const sendPasswordResetEmail = async (email, resetLink) => {
  try {
    if (!transporter) {
      initializeTransporter();
    }

    const mailOptions = {
      from: getEmailFrom(),
      to: email,
      subject: 'Password Reset Request - MedDec',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f9ff; border-radius: 8px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h1 style="color: #0c4a7a; margin-bottom: 20px;">Reset Your Password</h1>
            
            <p style="color: #556c87; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Hello,
            </p>
            
            <p style="color: #556c87; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              We received a request to reset your password. Click the link below to create a new password.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" style="background-color: #0d6efd; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
                Reset Password
              </a>
            </div>
            
            <p style="color: #556c87; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
              Or copy and paste this link in your browser:
            </p>
            
            <p style="color: #0d6efd; font-size: 12px; word-break: break-all; margin-bottom: 20px; background-color: #f5f9ff; padding: 10px; border-radius: 4px;">
              ${resetLink}
            </p>
            
            <hr style="border: none; border-top: 1px solid #e0e7f1; margin: 20px 0;">
            
            <p style="color: #8fa9c4; font-size: 12px; line-height: 1.6;">
              This link will expire in 15 minutes. If you didn't request a password reset, please ignore this email.
            </p>
            
            <p style="color: #8fa9c4; font-size: 12px; line-height: 1.6; margin-top: 20px;">
              Best regards,<br>
              <strong>MedDec Team</strong>
            </p>
          </div>
        </div>
      `,
      text: `
        Reset Your Password
        
        We received a request to reset your password. Click the link below to create a new password.
        
        ${resetLink}
        
        This link will expire in 15 minutes. If you didn't request a password reset, please ignore this email.
        
        Best regards,
        MedDec Team
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.response);
    return { success: true, message: 'Email sent successfully' };
  } catch (error) {
    if (error.code === 'ETIMEDOUT' && isGmailHost() && getSmtpPort() === 587) {
      console.warn('Gmail port 587 timed out, retrying with secure port 465...');
      initializeGmailFallbackTransporter();
      const info = await transporter.sendMail(mailOptions);
      console.log('Email sent successfully with Gmail secure fallback:', info.response);
      return { success: true, message: 'Email sent successfully' };
    }

    if (
      isGmailHost() &&
      (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        (error.message && error.message.includes('unable to verify the first certificate')) ||
        (error.message && error.message.includes('self signed certificate')))
    ) {
      console.warn('Gmail TLS certificate validation failed, retrying with relaxed TLS verification...');
      initializeTransporter({ tls: { rejectUnauthorized: false } });
      const info = await transporter.sendMail(mailOptions);
      console.log('Email sent successfully with relaxed TLS verification:', info.response);
      return { success: true, message: 'Email sent successfully' };
    }

    console.error('Error sending email:', error);
    throw error;
  }
};

export const sendInviteEmail = async (email, inviteLink, role = 'staff') => {
  try {
    if (!transporter) {
      initializeTransporter();
    }

    const mailOptions = {
      from: getEmailFrom(),
      to: email,
      subject: `Invitation to join MedDec as ${role}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f9ff; border-radius: 8px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h1 style="color: #0c4a7a; margin-bottom: 20px;">You're Invited to MedDec</h1>
            <p style="color: #556c87; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Hello,
            </p>
            <p style="color: #556c87; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              You have been invited to join MedDec as a <strong>${role}</strong>. Click the button below to set your password and activate your account.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${inviteLink}" style="background-color: #0d6efd; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
                Activate Account
              </a>
            </div>
            <p style="color: #556c87; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
              Or copy and paste this link into your browser:
            </p>
            <p style="color: #0d6efd; font-size: 12px; word-break: break-all; margin-bottom: 20px; background-color: #f5f9ff; padding: 10px; border-radius: 4px;">
              ${inviteLink}
            </p>
            <hr style="border: none; border-top: 1px solid #e0e7f1; margin: 20px 0;">
            <p style="color: #8fa9c4; font-size: 12px; line-height: 1.6;">
              This invite link will expire in 24 hours. If you did not expect this invitation, please contact your administrator.
            </p>
            <p style="color: #8fa9c4; font-size: 12px; line-height: 1.6; margin-top: 20px;">
              Best regards,<br>
              <strong>MedDec Team</strong>
            </p>
          </div>
        </div>
      `,
      text: `
        You're Invited to MedDec

        You have been invited to join MedDec as a ${role}. Visit the link below to set your password and activate your account.

        ${inviteLink}

        This invite link will expire in 24 hours. If you did not expect this invitation, please contact your administrator.

        Best regards,
        MedDec Team
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Invite email sent successfully:', info.response);
    return { success: true, message: 'Invite email sent successfully' };
  } catch (error) {
    if (error.code === 'ETIMEDOUT' && isGmailHost() && getSmtpPort() === 587) {
      console.warn('Gmail port 587 timed out, retrying with secure port 465...');
      initializeGmailFallbackTransporter();
      const info = await transporter.sendMail(mailOptions);
      console.log('Invite email sent successfully with Gmail secure fallback:', info.response);
      return { success: true, message: 'Invite email sent successfully' };
    }

    if (
      isGmailHost() &&
      (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        (error.message && error.message.includes('unable to verify the first certificate')) ||
        (error.message && error.message.includes('self signed certificate')))
    ) {
      console.warn('Gmail TLS certificate validation failed, retrying with relaxed TLS verification...');
      initializeTransporter({ tls: { rejectUnauthorized: false } });
      const info = await transporter.sendMail(mailOptions);
      console.log('Invite email sent successfully with relaxed TLS verification:', info.response);
      return { success: true, message: 'Invite email sent successfully' };
    }

    console.error('Error sending invite email:', error);
    throw error;
  }
};

export const sendDeletionEmail = async (email, name, role) => {
  try {
    if (!transporter) {
      initializeTransporter();
    }

    const mailOptions = {
      from: getEmailFrom(),
      to: email,
      subject: 'Account Removal Notification - MedDec',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f9ff; border-radius: 8px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h1 style="color: #0c4a7a; margin-bottom: 20px;">Account Removed</h1>
            <p style="color: #556c87; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Hello ${name || 'User'},
            </p>
            <p style="color: #556c87; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              Your MedDec account with the role of <strong>${role}</strong> has been removed by the system administrator.
            </p>
            <p style="color: #556c87; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
              If you believe this was a mistake or need further assistance, please contact your administrator.
            </p>
            <hr style="border: none; border-top: 1px solid #e0e7f1; margin: 20px 0;">
            <p style="color: #8fa9c4; font-size: 12px; line-height: 1.6; margin-top: 20px;">
              Best regards,<br>
              <strong>MedDec Team</strong>
            </p>
          </div>
        </div>
      `,
      text: `
        Account Removed

        Hello ${name || 'User'},

        Your MedDec account with the role of ${role} has been removed by the system administrator.

        If you believe this was a mistake or need further assistance, please contact your administrator.

        Best regards,
        MedDec Team
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Deletion email sent successfully:', info.response);
    return { success: true, message: 'Deletion email sent successfully' };
  } catch (error) {
    if (error.code === 'ETIMEDOUT' && isGmailHost() && getSmtpPort() === 587) {
      console.warn('Gmail port 587 timed out, retrying with secure port 465...');
      initializeGmailFallbackTransporter();
      const info = await transporter.sendMail(mailOptions);
      console.log('Deletion email sent successfully with Gmail secure fallback:', info.response);
      return { success: true, message: 'Deletion email sent successfully' };
    }

    if (
      isGmailHost() &&
      (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        (error.message && error.message.includes('unable to verify the first certificate')) ||
        (error.message && error.message.includes('self signed certificate')))
    ) {
      console.warn('Gmail TLS certificate validation failed, retrying with relaxed TLS verification...');
      initializeTransporter({ tls: { rejectUnauthorized: false } });
      const info = await transporter.sendMail(mailOptions);
      console.log('Deletion email sent successfully with relaxed TLS verification:', info.response);
      return { success: true, message: 'Deletion email sent successfully' };
    }

    console.error('Error sending deletion email:', error);
    throw error;
  }
};

// Verify email configuration on startup
export const verifyEmailConfig = async () => {
  try {
    if (!getEmailUser() || !getEmailPass()) {
      console.warn('⚠️  Email configuration is incomplete. Password reset emails will not be sent.');
      return false;
    }

    if (!transporter) {
      initializeTransporter();
    }

    await transporter.verify();
    console.log('✓ Email service verified and ready to send');
    return true;
  } catch (error) {
    console.error('⚠️  Email service verification failed:', error.message);

    if (error.code === 'ETIMEDOUT' && isGmailHost() && getSmtpPort() === 587) {
      console.warn('Gmail port 587 timed out during verification, retrying with secure port 465...');
      initializeGmailFallbackTransporter();
      try {
        await transporter.verify();
        console.log('✓ Email service verified using Gmail secure fallback');
        return true;
      } catch (fallbackError) {
        console.error('⚠️  Gmail secure fallback verification failed:', fallbackError.message);
      }
    }

    if (
      isGmailHost() &&
      (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        (error.message && error.message.includes('unable to verify the first certificate')) ||
        (error.message && error.message.includes('self signed certificate')))
    ) {
      console.warn('Gmail TLS certificate validation failed during verification, retrying with relaxed TLS verification...');
      initializeTransporter({ tls: { rejectUnauthorized: false } });
      try {
        await transporter.verify();
        console.log('✓ Email service verified using relaxed TLS verification');
        return true;
      } catch (fallbackError) {
        console.error('⚠️  Gmail relaxed TLS verification failed:', fallbackError.message);
      }
    }

    if (error.code === 'ENOTFOUND') {
      console.error('Please check your SMTP_HOST/DNS settings and internet connectivity.');
    }
    return false;
  }
};
