import express from 'express';
import { verifyToken } from '../utils/authMiddleware.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import NotificationService from '../utils/notificationService.js';

const router = express.Router();
router.use(verifyToken);

// Get logistics orders (assigned to this driver)
router.get('/orders', async (req, res) => {
  try {
    if (req.user.role !== 'logistics') {
      return res.status(403).json({ error: 'Access denied: logistics users only' });
    }

    const orders = await Order.find({
      'logistics.id': req.user._id,
      status: { $in: ['ready', 'picked_up', 'in_transit'] }
    })
      .sort({ createdAt: -1 })
      .populate('patient.id', 'name email location')
      .populate('pharmacy.id', 'name location pharmacyDetails');

    res.json({ orders });
  } catch (error) {
    console.error('Error fetching logistics orders:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Assign logistics to an order (admin function, but can be called by logistics for self-assignment)
router.post('/orders/:orderId/assign', async (req, res) => {
  try {
    if (req.user.role !== 'logistics') {
      return res.status(403).json({ error: 'Access denied: logistics users only' });
    }

    const order = await Order.findOne({ orderId: req.params.orderId });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status !== 'ready') {
      return res.status(400).json({ error: 'Order must be ready for pickup' });
    }

    if (order.logistics.id) {
      return res.status(400).json({ error: 'Order already assigned to logistics' });
    }

    // Assign logistics
    order.logistics = {
      id: req.user._id,
      name: req.user.name,
      status: 'assigned',
      assignedAt: new Date(),
    };
    order.timeline.push({
      status: 'assigned',
      actor: req.user._id,
      notes: `Assigned to logistics driver ${req.user.name}`,
    });
    await order.save();

    // Update logistics metrics
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 'logisticsMetrics.pickupsAssigned': 1 },
      $push: {
        activityLogs: {
          eventType: 'logistics',
          title: 'Order Assigned',
          description: `Assigned to deliver order ${order.orderId}`,
          orderId: order.orderId,
          timestamp: new Date(),
        }
      },
      lastActiveAt: new Date(),
    });

    // Send real-time notifications
    NotificationService.logisticsAssigned(order, order.patient.id, req.user._id);

    res.json({ message: 'Order assigned successfully', order });
  } catch (error) {
    console.error('Error assigning order:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Pickup an order
router.post('/orders/:orderId/pickup', async (req, res) => {
  try {
    if (req.user.role !== 'logistics') {
      return res.status(403).json({ error: 'Access denied: logistics users only' });
    }

    const order = await Order.findOne({
      orderId: req.params.orderId,
      'logistics.id': req.user._id
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found or not assigned to you' });
    }

    if (order.status !== 'ready' && order.logistics.status !== 'assigned') {
      return res.status(400).json({ error: 'Order not ready for pickup' });
    }

    // Update order status
    order.status = 'picked_up';
    order.logistics.status = 'picked_up';
    order.logistics.pickedUpAt = new Date();
    order.timeline.push({
      status: 'picked_up',
      actor: req.user._id,
      notes: 'Order picked up from pharmacy',
    });
    await order.save();

    // Update logistics metrics
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 'logisticsMetrics.pickupsCompleted': 1 },
      $push: {
        activityLogs: {
          eventType: 'logistics',
          title: 'Order Picked Up',
          description: `Picked up order ${order.orderId} from pharmacy`,
          orderId: order.orderId,
          timestamp: new Date(),
        }
      },
      lastActiveAt: new Date(),
    });

    // Send real-time notifications
    NotificationService.deliveryUpdate(order, order.patient.id, req.user._id);

    res.json({ message: 'Order picked up successfully', order });
  } catch (error) {
    console.error('Error picking up order:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update delivery status and location
router.post('/orders/:orderId/update', async (req, res) => {
  try {
    if (req.user.role !== 'logistics') {
      return res.status(403).json({ error: 'Access denied: logistics users only' });
    }

    const { status, currentLocation, eta } = req.body;

    const order = await Order.findOne({
      orderId: req.params.orderId,
      'logistics.id': req.user._id
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found or not assigned to you' });
    }

    // Update logistics status
    if (status) {
      order.logistics.status = status;
      order.status = status === 'delivered' ? 'delivered' : 'in_transit';

      if (status === 'delivered') {
        order.logistics.deliveredAt = new Date();
      }
    }

    if (currentLocation) {
      order.logistics.currentLocation = currentLocation;
    }

    if (eta) {
      order.logistics.eta = eta;
    }

    order.timeline.push({
      status: order.status,
      actor: req.user._id,
      notes: `Status updated to ${status}`,
    });
    await order.save();

    // Update metrics if delivered
    if (status === 'delivered') {
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { 'logisticsMetrics.deliveriesUpdated': 1 },
        $push: {
          activityLogs: {
            eventType: 'logistics',
            title: 'Order Delivered',
            description: `Delivered order ${order.orderId} to patient`,
            orderId: order.orderId,
            timestamp: new Date(),
          }
        },
        lastActiveAt: new Date(),
      });
    }

    // Send real-time notifications
    if (status === 'delivered') {
      NotificationService.deliveryCompleted(order, order.patient.id, req.user._id);
    } else {
      NotificationService.deliveryUpdate(order, order.patient.id, req.user._id);
    }

    res.json({ message: 'Order status updated successfully', order });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get logistics statistics
router.get('/stats', async (req, res) => {
  try {
    if (req.user.role !== 'logistics') {
      return res.status(403).json({ error: 'Access denied: logistics users only' });
    }

    const user = await User.findById(req.user._id);

    // Get order counts by status
    const orderStats = await Order.aggregate([
      { $match: { 'logistics.id': req.user._id } },
      {
        $group: {
          _id: '$logistics.status',
          count: { $sum: 1 }
        }
      }
    ]);

    const stats = {
      totalAssigned: user.logisticsMetrics.pickupsAssigned,
      pickupsCompleted: user.logisticsMetrics.pickupsCompleted,
      deliveriesCompleted: user.logisticsMetrics.deliveriesUpdated,
      ordersByStatus: orderStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {}),
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching logistics stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get order details
router.get('/orders/:orderId', async (req, res) => {
  try {
    if (req.user.role !== 'logistics') {
      return res.status(403).json({ error: 'Access denied: logistics users only' });
    }

    const order = await Order.findOne({
      orderId: req.params.orderId,
      'logistics.id': req.user._id
    }).populate('patient.id', 'name email location')
      .populate('pharmacy.id', 'name location pharmacyDetails');

    if (!order) {
      return res.status(404).json({ error: 'Order not found or not assigned to you' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get available orders for assignment (ready for pickup)
router.get('/available-orders', async (req, res) => {
  try {
    if (req.user.role !== 'logistics') {
      return res.status(403).json({ error: 'Access denied: logistics users only' });
    }

    const orders = await Order.find({
      status: 'ready',
      'logistics.id': { $exists: false }
    })
      .sort({ createdAt: -1 })
      .populate('pharmacy.id', 'name location')
      .populate('patient.id', 'name location')
      .select('orderId pharmacy patient deliveryAddress items priority createdAt');

    res.json({ orders });
  } catch (error) {
    console.error('Error fetching available orders:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
