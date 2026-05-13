import express from 'express';
import bcrypt from 'bcrypt';
import User from '../models/User.js';
import { verifyToken, requireRole } from '../utils/authMiddleware.js';
import { sendPassKeyEmail, sendDeletionEmail } from '../utils/emailService.js';

const router = express.Router();
router.use(verifyToken);
router.use(requireRole('admin'));

const reports = [
  { id: 'R-101', title: 'Monthly Active Patients', value: 452 },
  { id: 'R-102', title: 'Pharmacy Order Volume', value: 128 },
];

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const getJwtSecret = () => {
  if (!process.env.JWT_SECRET) {
    console.warn('JWT_SECRET is not set in environment variables, using fallback secret.');
  }
  return process.env.JWT_SECRET || 'dev_jwt_secret';
};

export const generatePassKey = (role) => {
  const roleAbbrev = role === 'logistics' ? 'log' : role === 'pharmacy' ? 'pharm' : 'admin';
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const randomPart = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `Med-${roleAbbrev}-${randomPart}`;
};

router.get('/users', async (req, res) => {
  try {
    const users = await User.find()
      .select(
        'name email role status inviteExpires lastLogin lastActiveAt totalSessionSeconds pharmacyMetrics logisticsMetrics activityLogs createdAt'
      )
      .sort({ createdAt: -1 });
    res.json({ users });
  } catch (error) {
    console.error('Failed to load admin users:', error.message);
    res.status(500).json({ error: 'Unable to retrieve users' });
  }
});

// Generic user creation route (handles pharmacy, logistics, admin)
router.post('/users', async (req, res) => {
  try {
    const { name, email, role, address, city, state, zipCode, latitude, longitude, phone, services, operatingHours } = req.body;

    if (!name || !email || !role) {
      return res.status(400).json({ error: 'Name, email, and role are required' });
    }

    if (!['pharmacy', 'logistics', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be pharmacy, logistics, or admin' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const passKey = generatePassKey(role);
    const hashedPassword = await bcrypt.hash(passKey, 10);

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role,
      status: 'active',
    });

    // Add role-specific details
    if (role === 'pharmacy' && (latitude && longitude)) {
      newUser.location = {
        address: address || '',
        city: city || '',
        state: state || '',
        zipCode: zipCode || '',
        coordinates: { latitude, longitude },
        lastUpdated: new Date(),
      };
      newUser.pharmacyDetails = {
        licenseNumber: `LIC-${Date.now()}`,
        operatingHours: operatingHours || {
          monday: { open: '09:00', close: '18:00', isOpen: true },
          tuesday: { open: '09:00', close: '18:00', isOpen: true },
          wednesday: { open: '09:00', close: '18:00', isOpen: true },
          thursday: { open: '09:00', close: '18:00', isOpen: true },
          friday: { open: '09:00', close: '18:00', isOpen: true },
          saturday: { open: '10:00', close: '16:00', isOpen: true },
          sunday: { open: '00:00', close: '00:00', isOpen: false },
        },
        phone: phone || '',
        services: services || ['24/7'],
        isActive: true,
      };
    }

    if (role === 'logistics') {
      newUser.logisticsDetails = {
        licenseNumber: `LOG-${Date.now()}`,
        phone: phone || '',
        vehicleInfo: { type: 'motorcycle', color: 'black', plate: '' },
        isActive: true,
      };
    }

    await newUser.save();

    try {
      await sendPassKeyEmail(email, passKey, role);
    } catch (emailError) {
      console.error('Failed to send pass key email:', emailError);
      await User.findByIdAndDelete(newUser._id);
      return res.status(500).json({ error: 'Unable to send pass key email' });
    }

    res.status(201).json({
      message: 'User created and pass key email sent successfully',
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        status: newUser.status,
        createdAt: newUser.createdAt,
      },
    });
  } catch (error) {
    console.error('Failed to create user:', error.message);
    res.status(500).json({ error: 'Unable to create user', details: error.message });
  }
});

router.post('/users/pharmacy', async (req, res) => {
  try {
    const { name, email, address, city, state, zipCode, latitude, longitude, phone, services, operatingHours } = req.body;

    if (!name || !email || !latitude || !longitude) {
      return res.status(400).json({ error: 'Name, email, latitude, and longitude are required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const passKey = generatePassKey('pharmacy');
    const hashedPassword = await bcrypt.hash(passKey, 10);

    const newPharmacy = new User({
      name,
      email,
      password: hashedPassword,
      role: 'pharmacy',
      status: 'active',
      location: {
        address,
        city,
        state,
        zipCode,
        coordinates: { latitude, longitude },
        lastUpdated: new Date(),
      },
      pharmacyDetails: {
        licenseNumber: `LIC-${Date.now()}`,
        operatingHours: operatingHours || {
          monday: { open: '09:00', close: '18:00', isOpen: true },
          tuesday: { open: '09:00', close: '18:00', isOpen: true },
          wednesday: { open: '09:00', close: '18:00', isOpen: true },
          thursday: { open: '09:00', close: '18:00', isOpen: true },
          friday: { open: '09:00', close: '18:00', isOpen: true },
          saturday: { open: '10:00', close: '16:00', isOpen: true },
          sunday: { open: '00:00', close: '00:00', isOpen: false },
        },
        phone,
        services: services || ['24/7'],
        isActive: true,
      },
    });

    await newPharmacy.save();

    try {
      await sendPassKeyEmail(email, passKey, 'pharmacy');
    } catch (emailError) {
      console.error('Failed to send pass key email:', emailError);
      await User.findByIdAndDelete(newPharmacy._id);
      return res.status(500).json({ error: 'Unable to send pass key email' });
    }

    res.status(201).json({
      message: 'Pharmacy created and pass key email sent successfully',
      pharmacy: {
        id: newPharmacy._id,
        name: newPharmacy.name,
        email: newPharmacy.email,
        location: newPharmacy.location,
        pharmacyDetails: newPharmacy.pharmacyDetails,
      },
    });
  } catch (error) {
    console.error('Failed to create pharmacy:', error.message);
    res.status(500).json({ error: 'Unable to create pharmacy' });
  }
});

// Update user details and/or role
router.put('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, email, role, status } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if email is being changed and if new email already exists
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ error: 'Email already exists' });
      }
      user.email = email;
    }

    if (name) user.name = name;
    if (role && ['admin', 'pharmacy', 'logistics', 'patient'].includes(role)) {
      user.role = role;
    }
    if (status && ['active', 'inactive', 'pending'].includes(status)) {
      user.status = status;
    }

    await user.save();

    res.json({
      message: 'User updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('Failed to update user:', error.message);
    res.status(500).json({ error: 'Unable to update user' });
  }
});

// Delete user
router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Prevent deleting the admin you're logged in as
    const requestingUser = req.user;
    if (userId === requestingUser.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const user = await User.findByIdAndDelete(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let emailNotification = { success: true };
    try {
      await sendDeletionEmail(user.email, user.name, user.role);
    } catch (emailError) {
      console.warn('User deleted but deletion email failed:', emailError.message || emailError);
      emailNotification = {
        success: false,
        error: emailError.message || 'Failed to send deletion notification email',
      };
    }

    res.json({
      message: 'User deleted successfully',
      emailNotification,
    });
  } catch (error) {
    console.error('Failed to delete user:', error.message);
    res.status(500).json({ error: 'Unable to delete user' });
  }
});

router.get('/reports', async (req, res) => {
  try {
    const activeStaffCount = await User.countDocuments({
      role: { $in: ['admin', 'pharmacy', 'logistics'] },
      status: 'active',
    });

    const pharmacyStaff = await User.find({ role: 'pharmacy' }).select('pharmacyMetrics');
    const logisticsStaff = await User.find({ role: 'logistics' }).select('logisticsMetrics');

    const pharmacyOrdersHandled = pharmacyStaff.reduce(
      (sum, user) => sum + (user.pharmacyMetrics?.ordersHandled || 0),
      0
    );
    const pharmacyAccepted = pharmacyStaff.reduce(
      (sum, user) => sum + (user.pharmacyMetrics?.accepted || 0),
      0
    );
    const pharmacyRejected = pharmacyStaff.reduce(
      (sum, user) => sum + (user.pharmacyMetrics?.rejected || 0),
      0
    );
    const logisticsPickups = logisticsStaff.reduce(
      (sum, user) => sum + (user.logisticsMetrics?.pickupsCompleted || 0),
      0
    );
    const logisticsDeliveries = logisticsStaff.reduce(
      (sum, user) => sum + (user.logisticsMetrics?.deliveriesUpdated || 0),
      0
    );

    const dynamicReports = [
      { id: 'R-101', title: 'Active Staff', value: activeStaffCount },
      { id: 'R-102', title: 'Pharmacy Orders Handled', value: pharmacyOrdersHandled },
      { id: 'R-103', title: 'Pharmacy Accepted', value: pharmacyAccepted },
      { id: 'R-104', title: 'Pharmacy Rejected', value: pharmacyRejected },
      { id: 'R-105', title: 'Logistics Pickups', value: logisticsPickups },
      { id: 'R-106', title: 'Logistics Deliveries', value: logisticsDeliveries },
    ];

    res.json({ reports: dynamicReports });
  } catch (error) {
    console.error('Failed to load admin reports:', error.message);
    res.status(500).json({ error: 'Unable to retrieve reports' });
  }
});

export default router;
