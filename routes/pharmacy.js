import express from 'express';
import { verifyToken } from '../utils/authMiddleware.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import NotificationService from '../utils/notificationService.js';

const router = express.Router();
router.use(verifyToken);

// Get pharmacy orders
router.get('/orders', async (req, res) => {
  try {
    if (req.user.role !== 'pharmacy') {
      return res.status(403).json({ error: 'Access denied: pharmacy users only' });
    }

    const orders = await Order.find({ 'pharmacy.id': req.user._id })
      .sort({ createdAt: -1 })
      .populate('patient.id', 'name email')
      .populate('logistics.id', 'name');

    res.json({ orders });
  } catch (error) {
    console.error('Error fetching pharmacy orders:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Accept an order
router.post('/orders/:orderId/accept', async (req, res) => {
  try {
    if (req.user.role !== 'pharmacy') {
      return res.status(403).json({ error: 'Access denied: pharmacy users only' });
    }

    const order = await Order.findOne({
      orderId: req.params.orderId,
      'pharmacy.id': req.user._id
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status !== 'placed') {
      return res.status(400).json({ error: 'Order cannot be accepted at this stage' });
    }

    // Update order status
    order.status = 'confirmed';
    order.timeline.push({
      status: 'confirmed',
      actor: req.user._id,
      notes: 'Order confirmed by pharmacy',
    });
    await order.save();

    // Update pharmacy metrics
    await User.findByIdAndUpdate(req.user._id, {
      $inc: {
        'pharmacyMetrics.ordersHandled': 1,
        'pharmacyMetrics.accepted': 1
      },
      $push: {
        activityLogs: {
          eventType: 'order',
          title: 'Order Confirmed',
          description: `Confirmed order ${order.orderId} for ${order.patient.name}`,
          orderId: order.orderId,
          timestamp: new Date(),
        }
      },
      lastActiveAt: new Date(),
    });

    // Send real-time notifications
    NotificationService.pharmacyResponse(order, order.patient.id, true);
    NotificationService.orderStatusUpdate(order, order.patient.id, 'patient');

    res.json({ message: 'Order accepted successfully', order });
  } catch (error) {
    console.error('Error accepting order:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reject an order
router.post('/orders/:orderId/reject', async (req, res) => {
  try {
    if (req.user.role !== 'pharmacy') {
      return res.status(403).json({ error: 'Access denied: pharmacy users only' });
    }

    const order = await Order.findOne({
      orderId: req.params.orderId,
      'pharmacy.id': req.user._id
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status !== 'placed') {
      return res.status(400).json({ error: 'Order cannot be rejected at this stage' });
    }

    // Update order status
    order.status = 'cancelled';
    order.timeline.push({
      status: 'cancelled',
      actor: req.user._id,
      notes: 'Order cancelled by pharmacy',
    });
    await order.save();

    // Update pharmacy metrics
    await User.findByIdAndUpdate(req.user._id, {
      $inc: {
        'pharmacyMetrics.ordersHandled': 1,
        'pharmacyMetrics.rejected': 1
      },
      $push: {
        activityLogs: {
          eventType: 'order',
          title: 'Order Rejected',
          description: `Rejected order ${order.orderId} for ${order.patient.name}`,
          orderId: order.orderId,
          timestamp: new Date(),
        }
      },
      lastActiveAt: new Date(),
    });

    // Send real-time notifications
    NotificationService.pharmacyResponse(order, order.patient.id, false);
    NotificationService.orderStatusUpdate(order, order.patient.id, 'patient');

    res.json({ message: 'Order rejected successfully', order });
  } catch (error) {
    console.error('Error rejecting order:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark order as ready for pickup
router.post('/orders/:orderId/ready', async (req, res) => {
  try {
    if (req.user.role !== 'pharmacy') {
      return res.status(403).json({ error: 'Access denied: pharmacy users only' });
    }

    const order = await Order.findOne({
      orderId: req.params.orderId,
      'pharmacy.id': req.user._id
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status !== 'confirmed') {
      return res.status(400).json({ error: 'Order must be confirmed first' });
    }

    // Update order status
    order.status = 'ready';
    order.timeline.push({
      status: 'ready',
      actor: req.user._id,
      notes: 'Order ready for pickup/delivery',
    });
    await order.save();

    res.json({ message: 'Order marked as ready', order });
  } catch (error) {
    console.error('Error marking order ready:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get pharmacy statistics
router.get('/stats', async (req, res) => {
  try {
    if (req.user.role !== 'pharmacy') {
      return res.status(403).json({ error: 'Access denied: pharmacy users only' });
    }

    const user = await User.findById(req.user._id);

    // Get order counts by status
    const orderStats = await Order.aggregate([
      { $match: { 'pharmacy.id': req.user._id } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const stats = {
      totalOrders: user.pharmacyMetrics.ordersHandled,
      acceptedOrders: user.pharmacyMetrics.accepted,
      rejectedOrders: user.pharmacyMetrics.rejected,
      ordersByStatus: orderStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {}),
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching pharmacy stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get order details
router.get('/orders/:orderId', async (req, res) => {
  try {
    if (req.user.role !== 'pharmacy') {
      return res.status(403).json({ error: 'Access denied: pharmacy users only' });
    }

    const order = await Order.findOne({
      orderId: req.params.orderId,
      'pharmacy.id': req.user._id
    }).populate('patient.id', 'name email location')
      .populate('logistics.id', 'name');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get inventory alerts (low stock items)
router.get('/inventory/alerts', async (req, res) => {
  try {
    if (req.user.role !== 'pharmacy') {
      return res.status(403).json({ error: 'Access denied: pharmacy users only' });
    }

    // For now, return static inventory alerts
    // In a real app, this would come from an inventory collection
    const alerts = [
      { id: 'RX-104', name: 'Ibuprofen 400mg', available: 3, threshold: 5, status: 'low' },
      { id: 'RX-102', name: 'Lisinopril 10mg', available: 7, threshold: 10, status: 'low' },
    ];

    res.json({ alerts });
  } catch (error) {
    console.error('Error fetching inventory alerts:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
