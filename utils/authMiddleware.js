import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const getJwtSecret = () => {
  if (!process.env.JWT_SECRET) {
    console.warn('JWT_SECRET is not set in environment variables, using fallback secret.');
  }
  return process.env.JWT_SECRET || 'dev_jwt_secret';
};

export async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, getJwtSecret());
    const user = await User.findById(payload.id).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
}
