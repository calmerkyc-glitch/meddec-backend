import express from 'express';
import { verifyToken } from '../utils/authMiddleware.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import { Chat, Message } from '../models/Chat.js';
import NotificationService from '../utils/notificationService.js';

const router = express.Router();

// Get user's active chats
router.get('/chats', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const chats = await Chat.find({
      'participants.userId': req.user._id,
      status: 'active'
    })
    .populate('participants.userId', 'name role chatStatus lastSeen')
    .sort({ updatedAt: -1 });

    // Get unread counts for each chat
    const chatsWithUnread = await Promise.all(
      chats.map(async (chat) => {
        const unreadCount = await Message.countDocuments({
          chatId: chat._id,
          senderId: { $ne: req.user._id },
          isRead: false
        });

        return {
          ...chat.toObject(),
          unreadCount
        };
      })
    );

    res.json(chatsWithUnread);
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Start a new chat for an order
router.post('/orders/:orderId/chat', verifyToken, async (req, res) => {
  try {
    const { chatType = 'order-support' } = req.body;

    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Check if user is authorized to chat about this order
    const isPatient = order.patient.id.toString() === req.user._id.toString();
    const isPharmacy = order.pharmacy?.id?.toString() === req.user._id.toString();
    const isLogistics = order.logistics?.id?.toString() === req.user._id.toString();

    if (!isPatient && !isPharmacy && !isLogistics) {
      return res.status(403).json({ error: 'Not authorized to access this order chat' });
    }

    // Check if chat already exists
    let chat = await Chat.findOne({
      orderId: req.params.orderId,
      'participants.userId': req.user._id,
      status: 'active'
    });

    if (chat) {
      return res.json(chat);
    }

    // Create new chat
    const participants = [];

    // Add patient
    if (order.patient.id) {
      const patient = await User.findById(order.patient.id);
      if (patient) {
        participants.push({
          userId: patient._id,
          role: 'patient',
          name: patient.name
        });
      }
    }

    // Add pharmacy if assigned
    if (order.pharmacy?.id) {
      const pharmacy = await User.findById(order.pharmacy.id);
      if (pharmacy) {
        participants.push({
          userId: pharmacy._id,
          role: 'pharmacy',
          name: pharmacy.name
        });
      }
    }

    // Add logistics if assigned
    if (order.logistics?.id) {
      const logistics = await User.findById(order.logistics.id);
      if (logistics) {
        participants.push({
          userId: logistics._id,
          role: 'logistics',
          name: logistics.name
        });
      }
    }

    chat = new Chat({
      orderId: req.params.orderId,
      participants,
      chatType
    });

    await chat.save();

    // Update users' active chats
    for (const participant of participants) {
      await User.findByIdAndUpdate(participant.userId, {
        $push: {
          activeChats: {
            chatId: chat._id,
            orderId: req.params.orderId,
            lastActivity: new Date()
          }
        }
      });
    }

    // Send notification to other participants
    const otherParticipants = participants.filter(p => p.userId.toString() !== req.user._id.toString());
    for (const participant of otherParticipants) {
      NotificationService.sendChatNotification(chat, req.user, participant.userId);
    }

    res.status(201).json(chat);
  } catch (error) {
    console.error('Error creating chat:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get messages for a chat
router.get('/chats/:chatId/messages', verifyToken, async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    // Check if user is participant
    const isParticipant = chat.participants.some(p => p.userId.toString() === req.user._id.toString());
    if (!isParticipant) return res.status(403).json({ error: 'Not authorized to access this chat' });

    const messages = await Message.find({ chatId: req.params.chatId })
      .sort({ timestamp: 1 })
      .limit(100); // Limit to last 100 messages

    // Mark messages as read
    await Message.updateMany(
      {
        chatId: req.params.chatId,
        senderId: { $ne: req.user._id },
        isRead: false
      },
      {
        $set: { isRead: true },
        $push: {
          readBy: {
            userId: req.user._id,
            readAt: new Date()
          }
        }
      }
    );

    // Update user's unread count
    await User.findOneAndUpdate(
      { _id: req.user._id, 'activeChats.chatId': req.params.chatId },
      { $set: { 'activeChats.$.unreadCount': 0 } }
    );

    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Send a message
router.post('/chats/:chatId/messages', verifyToken, async (req, res) => {
  try {
    const { content, messageType = 'text' } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    const chat = await Chat.findById(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    // Check if user is participant
    const isParticipant = chat.participants.some(p => p.userId.toString() === req.user._id.toString());
    if (!isParticipant) return res.status(403).json({ error: 'Not authorized to access this chat' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const message = new Message({
      chatId: req.params.chatId,
      senderId: req.user._id,
      senderName: user.name,
      senderRole: user.role,
      content: content.trim(),
      messageType
    });

    await message.save();

    // Update chat's last message
    chat.lastMessage = {
      content: message.content,
      senderId: message.senderId,
      senderName: message.senderName,
      timestamp: message.timestamp
    };
    chat.updatedAt = new Date();
    await chat.save();

    // Update participants' active chats
    const otherParticipants = chat.participants.filter(p => p.userId.toString() !== req.user._id.toString());

    for (const participant of otherParticipants) {
      await User.findOneAndUpdate(
        { _id: participant.userId, 'activeChats.chatId': chat._id },
        {
          $set: { 'activeChats.$.lastActivity': new Date() },
          $inc: { 'activeChats.$.unreadCount': 1 }
        }
      );
    }

    // Emit real-time message to chat room
    const io = req.app.get('io');
    if (io) {
      io.to(`chat-${req.params.chatId}`).emit('new-message', {
        chatId: req.params.chatId,
        message: message
      });

      // Send notifications to offline participants
      for (const participant of otherParticipants) {
        const participantUser = await User.findById(participant.userId);
        if (participantUser && participantUser.chatStatus === 'offline') {
          NotificationService.sendChatMessageNotification(chat, message, participant.userId);
        }
      }
    }

    res.status(201).json(message);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Request a call for an order
router.post('/orders/:orderId/request-call', verifyToken, async (req, res) => {
  try {
    const { target = 'auto' } = req.body;
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const isPatient = order.patient.id.toString() === req.user._id.toString();
    const isPharmacy = order.pharmacy?.id?.toString() === req.user._id.toString();
    const isLogistics = order.logistics?.id?.toString() === req.user._id.toString();

    if (!isPatient && !isPharmacy && !isLogistics) {
      return res.status(403).json({ error: 'Not authorized to request call for this order' });
    }

    let recipientId = null;
    let recipientRole = null;

    if (target === 'pharmacy') {
      if (!order.pharmacy?.id) return res.status(400).json({ error: 'No pharmacy assigned to this order' });
      recipientId = order.pharmacy.id;
      recipientRole = 'pharmacy';
    } else if (target === 'logistics') {
      if (!order.logistics?.id) return res.status(400).json({ error: 'No logistics driver assigned yet' });
      recipientId = order.logistics.id;
      recipientRole = 'logistics';
    } else {
      if (order.logistics?.id) {
        recipientId = order.logistics.id;
        recipientRole = 'logistics';
      } else if (order.pharmacy?.id) {
        recipientId = order.pharmacy.id;
        recipientRole = 'pharmacy';
      }
    }

    if (!recipientId) {
      return res.status(400).json({ error: 'Unable to find a recipient for the call request' });
    }

    NotificationService.sendCallRequestNotification(order, req.user, recipientId, recipientRole);

    res.json({ message: 'Call request sent successfully', target: recipientRole });
  } catch (error) {
    console.error('Error creating call request:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user's chat status
router.put('/chat-status', verifyToken, async (req, res) => {
  try {
    const { status } = req.body;

    if (!['online', 'away', 'busy', 'offline'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await User.findByIdAndUpdate(req.user._id, {
      chatStatus: status,
      lastSeen: new Date()
    });

    // Emit status update to all user's chats
    const io = req.app.get('io');
    if (io) {
      io.emit('user-status-update', {
        userId: req.user._id,
        status,
        lastSeen: new Date()
      });
    }

    res.json({ status: 'updated' });
  } catch (error) {
    console.error('Error updating chat status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Close a chat
router.put('/chats/:chatId/close', verifyToken, async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    // Check if user is participant
    const isParticipant = chat.participants.some(p => p.userId.toString() === req.user._id.toString());
    if (!isParticipant) return res.status(403).json({ error: 'Not authorized to access this chat' });

    chat.status = 'closed';
    await chat.save();

    // Remove from users' active chats
    for (const participant of chat.participants) {
      await User.findByIdAndUpdate(participant.userId, {
        $pull: { activeChats: { chatId: chat._id } }
      });
    }

    res.json({ message: 'Chat closed successfully' });
  } catch (error) {
    console.error('Error closing chat:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;