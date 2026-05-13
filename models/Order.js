import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  patient: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: String,
    email: String,
    phone: String,
    address: String,
    location: {
      latitude: Number,
      longitude: Number,
    },
  },
  pharmacy: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: String,
    address: String,
    phone: String,
    location: {
      latitude: Number,
      longitude: Number,
    },
  },
  logistics: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    status: { type: String, enum: ['assigned', 'picked_up', 'in_transit', 'delivered'], default: null },
    assignedAt: Date,
    pickedUpAt: Date,
    deliveredAt: Date,
    currentLocation: {
      latitude: Number,
      longitude: Number,
      address: String,
    },
    eta: String,
  },
  items: [{
    medicine: { type: String, required: true },
    quantity: { type: Number, required: true },
    dosage: String,
    instructions: String,
    prescriptionId: String,
  }],
  status: {
    type: String,
    enum: ['placed', 'confirmed', 'preparing', 'ready', 'picked_up', 'in_transit', 'delivered', 'cancelled'],
    default: 'placed'
  },
  priority: {
    type: String,
    enum: ['normal', 'high', 'urgent'],
    default: 'normal'
  },
  prescription: {
    id: String,
    doctor: String,
    date: Date,
  },
  pricing: {
    subtotal: Number,
    deliveryFee: Number,
    tax: Number,
    total: Number,
  },
  timeline: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: String,
  }],
  deliveryAddress: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    coordinates: {
      latitude: Number,
      longitude: Number,
    },
  },
  notes: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Indexes for efficient queries
orderSchema.index({ 'patient.id': 1, status: 1 });
orderSchema.index({ 'pharmacy.id': 1, status: 1 });
orderSchema.index({ 'logistics.id': 1, status: 1 });
orderSchema.index({ 'deliveryAddress.coordinates': '2dsphere' });
orderSchema.index({ 'pharmacy.location.coordinates': '2dsphere' });

export default mongoose.model('Order', orderSchema);