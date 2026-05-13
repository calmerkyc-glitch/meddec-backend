import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { sendPasswordResetEmail, verifyEmailConfig } from '../utils/emailService.js';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../utils/authMiddleware.js';

const router = express.Router();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const RESET_TOKEN_EXPIRY = '15m';
const SMTP_USER = process.env.EMAIL_USER;
const SMTP_PASS = process.env.EMAIL_PASSWORD;
const isEmailConfigured = () => Boolean(SMTP_USER && SMTP_PASS);

// Rate limiting for forgot-password endpoint
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many password reset attempts. Please wait 1 hour and try again.' });
  },
});

const createDefaultPatientData = () => ({
  prescriptions: [
    { name: 'Lisinopril 10mg', status: 'Urgent', nextRefill: '4 days', doctor: 'Dr. Christine Obi' },
    { name: 'Metformin 500mg', status: 'Stable', nextRefill: '12 days', doctor: 'Dr. Tunde Adebayo' },
  ],
  refills: [
    { medicine: 'Amoxicillin 250mg', status: 'Processing', eta: 'Today' },
    { medicine: 'Vitamin D 2000IU', status: 'Scheduled', eta: 'Tomorrow' },
  ],
  consultations: [
    { time: 'Today, 2:30 PM', doctor: 'Dr. Sarah Mitchell', specialty: 'Cardiology', status: 'Upcoming' },
    { time: 'May 13, 11:00 AM', doctor: 'Dr. Amina Yusuf', specialty: 'Endocrinology', status: 'Confirmed' },
  ],
  records: [
    { title: 'Prescription History', description: 'All active and past prescriptions.' },
    { title: 'Lab Reports', description: 'Blood work and diagnostics available for review.' },
    { title: 'Insurance Documents', description: 'Upload and manage your insurance papers.' },
  ],
});

const getJwtSecret = () => {
  if (!process.env.JWT_SECRET) {
    console.warn('JWT_SECRET is not set in environment variables, using fallback secret.');
  }
  return process.env.JWT_SECRET || 'dev_jwt_secret';
};

// Signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role: 'patient',
      ...createDefaultPatientData(),
    });
    await newUser.save();
    const token = jwt.sign({ id: newUser._id }, getJwtSecret(), { expiresIn: '1h' });
    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (error) {
    res.status(400).json({ error: 'Signup failed', details: error.message });
  }
});

// Signin
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Account activation required. Please check your invitation email.' });
    }

    const now = new Date();
    user.lastLogin = now;
    user.sessionStart = now;
    user.lastActiveAt = now;
    user.activityLogs.unshift({
      eventType: 'login',
      title: 'Signed in',
      description: 'User signed in and session started',
      timestamp: now,
    });
    user.activityLogs = user.activityLogs.slice(0, 100);
    await user.save();

    const token = jwt.sign({ id: user._id }, getJwtSecret(), { expiresIn: '1h' });
    res.json({
      message: 'Signin successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role || 'patient',
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Signin failed', details: error.message });
  }
});

// Fetch authenticated user profile
router.get('/me', verifyToken, async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role || 'patient',
        status: req.user.status || 'active',
        patientId: `#${req.user._id.toString().slice(-6).toUpperCase()}`,
      },
    });
  } catch (error) {
    console.error('Profile fetch failed:', error.message);
    res.status(500).json({ error: 'Unable to fetch profile' });
  }
});

// Forgot Password
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    console.log('Forgot password request for:', email);

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal whether the email exists (security best practice)
      return res.json({ message: 'If this email exists, a reset link has been sent' });
    }

    const secret = getJwtSecret();
    const resetToken = jwt.sign({ id: user._id }, secret, { expiresIn: RESET_TOKEN_EXPIRY });
    const frontendUrl = req.get('origin') || FRONTEND_URL;
    const resetLink = `${frontendUrl}/reset-password/${resetToken}`;

    if (!isEmailConfigured()) {
      console.warn('Password reset email skipped: SMTP credentials missing.');
      console.log(`Development reset link for ${user.email}: ${resetLink}`);
      return res.json({
        message: 'If this email exists, a reset link has been sent',
        resetLink: process.env.NODE_ENV === 'production' ? undefined : resetLink,
      });
    }

    try {
      await sendPasswordResetEmail(user.email, resetLink);
      console.log('Reset email sent to:', user.email);
      res.json({ message: 'If this email exists, a reset link has been sent' });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      if (process.env.NODE_ENV !== 'production') {
        console.warn('Falling back to sending reset token in response for local development.');
        console.log(`Development reset link for ${user.email}: ${resetLink}`);
        return res.json({
          message: 'If this email exists, a reset link has been sent',
          resetLink,
        });
      }
      res.status(500).json({ 
        error: 'Failed to send reset email. Please try again later.',
        details: emailError.message 
      });
    }
  } catch (error) {
    console.error('Forgot password route error:', error);
    res.status(500).json({ error: 'Forgot password request failed', details: error.message });
  }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Reset token and new password are required' });
    }

    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret);

    let user;
    if (payload.type === 'invite') {
      user = await User.findOne({ email: payload.id });
    } else {
      user = await User.findById(payload.id);
    }

    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;

    if (payload.type === 'invite') {
      user.status = 'active';
      user.inviteToken = undefined;
      user.inviteExpires = undefined;
    }

    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Reset password route error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'Reset token has expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(400).json({ error: 'Invalid reset token' });
    }
    res.status(500).json({ error: 'Reset password failed', details: error.message });
  }
});

// Logout and close user session
router.post('/logout', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const now = new Date();
    if (user.sessionStart) {
      const sessionSeconds = Math.max(0, Math.floor((now - user.sessionStart) / 1000));
      user.totalSessionSeconds += sessionSeconds;
      user.activityLogs.unshift({
        eventType: 'logout',
        title: 'Signed out',
        description: `User signed out after ${Math.round(sessionSeconds / 60)} minute(s)`,
        timestamp: now,
      });
      user.activityLogs = user.activityLogs.slice(0, 100);
    }
    user.sessionStart = undefined;
    user.lastActiveAt = now;

    await user.save();
    res.json({ message: 'Logout recorded successfully' });
  } catch (error) {
    console.error('Logout failed:', error);
    res.status(500).json({ error: 'Logout failed', details: error.message });
  }
});

export default router;
