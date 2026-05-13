import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'patient' },
  status: { type: String, enum: ['active', 'inactive', 'pending'], default: 'active' },
  inviteToken: { type: String },
  inviteExpires: { type: Date },
  lastLogin: { type: Date },
  sessionStart: { type: Date },
  lastActiveAt: { type: Date },
  totalSessionSeconds: { type: Number, default: 0 },
  pharmacyMetrics: {
    ordersHandled: { type: Number, default: 0 },
    accepted: { type: Number, default: 0 },
    rejected: { type: Number, default: 0 },
  },
  logisticsMetrics: {
    pickupsAssigned: { type: Number, default: 0 },
    pickupsCompleted: { type: Number, default: 0 },
    deliveriesUpdated: { type: Number, default: 0 },
  },
  // Chat and communication fields
  chatStatus: { type: String, enum: ['online', 'away', 'busy', 'offline'], default: 'offline' },
  lastSeen: { type: Date, default: Date.now },
  activeChats: [{
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    orderId: String,
    unreadCount: { type: Number, default: 0 },
    lastActivity: Date
  }],
  activityLogs: {
    type: [
      {
        eventType: String,
        title: String,
        description: String,
        orderId: String,
        details: String,
        timestamp: Date,
      }
    ],
    default: [],
  },
  prescriptions: {
    type: [
      {
        name: String,
        status: String,
        nextRefill: String,
        doctor: String,
      }
    ],
    default: [],
  },
  refills: {
    type: [
      {
        medicine: String,
        status: String,
        eta: String,
      }
    ],
    default: [],
  },
  consultations: {
    type: [
      {
        time: String,
        doctor: String,
        specialty: String,
        status: String,
      }
    ],
    default: [],
  },
  // Location fields for pharmacies and patients
  location: {
    address: String,
    city: String,
    state: String,
    zipCode: String,
    coordinates: {
      latitude: Number,
      longitude: Number,
    },
    lastUpdated: Date,
  },
  // Pharmacy-specific fields
  pharmacyDetails: {
    licenseNumber: String,
    operatingHours: {
      monday: { open: String, close: String, isOpen: Boolean },
      tuesday: { open: String, close: String, isOpen: Boolean },
      wednesday: { open: String, close: String, isOpen: Boolean },
      thursday: { open: String, close: String, isOpen: Boolean },
      friday: { open: String, close: String, isOpen: Boolean },
      saturday: { open: String, close: String, isOpen: Boolean },
      sunday: { open: String, close: String, isOpen: Boolean },
    },
    phone: String,
    services: [String], // e.g., ['24/7', 'drive-thru', 'compounding']
    isActive: { type: Boolean, default: true },
  },
}, {
  timestamps: true,
});

export default mongoose.model('User', userSchema);
