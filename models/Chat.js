import mongoose from 'mongoose';

const chatSchema = new mongoose.Schema({
  orderId: { type: String, required: true },
  participants: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, required: true }, // 'patient', 'pharmacy', 'logistics'
    name: { type: String, required: true },
    joinedAt: { type: Date, default: Date.now }
  }],
  chatType: { type: String, enum: ['order-support', 'delivery-chat'], default: 'order-support' },
  status: { type: String, enum: ['active', 'closed'], default: 'active' },
  lastMessage: {
    content: String,
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    senderName: String,
    timestamp: Date
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderName: { type: String, required: true },
  senderRole: { type: String, required: true },
  content: { type: String, required: true },
  messageType: { type: String, enum: ['text', 'image', 'file'], default: 'text' },
  isRead: { type: Boolean, default: false },
  readBy: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    readAt: { type: Date, default: Date.now }
  }],
  timestamp: { type: Date, default: Date.now }
});

const Chat = mongoose.model('Chat', chatSchema);
const Message = mongoose.model('Message', messageSchema);

export { Chat, Message };
export default Chat;