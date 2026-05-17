import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import pharmacyRoutes from './routes/pharmacy.js';
import logisticsRoutes from './routes/logistics.js';
import adminRoutes from './routes/admin.js';
import patientRoutes from './routes/patient.js';
import chatRoutes from './routes/chat.js';
import { verifyEmailConfig } from './utils/emailService.js';

dotenv.config();
console.log('JWT_SECRET loaded:', !!process.env.JWT_SECRET);

// Flexible CORS for frontend deployments
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5174',
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  }
});

// Make io available to routes
app.set('io', io);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({ message: 'MedDec Backend is running', status: 'online' });
});

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/pharmacy', pharmacyRoutes);
app.use('/api/logistics', logisticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/chat', chatRoutes);

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error(err));

// Verify email configuration on startup
verifyEmailConfig();

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join user-specific room for targeted notifications
  socket.on('join-user-room', (userId) => {
    socket.join(`user_${userId}`);
    console.log(`User ${userId} joined room user_${userId}`);
  });

  // Join role-specific rooms
  socket.on('join-role-room', (role) => {
    socket.join(`role_${role}`);
    console.log(`User joined role room: ${role}`);
  });

  // Handle order tracking subscriptions
  socket.on('subscribe-order', (orderId) => {
    socket.join(`order_${orderId}`);
    console.log(`User subscribed to order: ${orderId}`);
  });

  // Join chat room
  socket.on('join-chat', (chatId) => {
    socket.join(`chat-${chatId}`);
    console.log(`User joined chat: ${chatId}`);
  });

  // Leave chat room
  socket.on('leave-chat', (chatId) => {
    socket.leave(`chat-${chatId}`);
    console.log(`User left chat: ${chatId}`);
  });

  // Handle typing indicators
  socket.on('typing-start', (data) => {
    socket.to(`chat-${data.chatId}`).emit('user-typing', {
      userId: data.userId,
      userName: data.userName,
      chatId: data.chatId
    });
  });

  socket.on('typing-stop', (data) => {
    socket.to(`chat-${data.chatId}`).emit('user-stopped-typing', {
      userId: data.userId,
      chatId: data.chatId
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Export io for use in routes
export { io };

const PORT = Number(process.env.PORT || 5000);

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the running server or set a different PORT in .env.`);
    return;
  }
  throw error;
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
