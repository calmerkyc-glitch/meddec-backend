import express from 'express';
import User from '../models/User.js';
import Order from '../models/Order.js';
import { verifyToken } from '../utils/authMiddleware.js';
import NotificationService from '../utils/notificationService.js';

const router = express.Router();

// Get nearby pharmacies based on patient location
router.get('/pharmacies/nearby', verifyToken, async (req, res) => {
  try {
    const { latitude, longitude, radius = 10 } = req.query; // radius in km

    if (!latitude || !longitude) {
      return res.status(400).json({ message: 'Location coordinates required' });
    }

    // Find all active pharmacies
    const pharmacies = await User.find({
      role: 'pharmacy',
      'pharmacyDetails.isActive': true,
      'location.coordinates.latitude': { $exists: true },
      'location.coordinates.longitude': { $exists: true }
    }).select('name email pharmacyDetails location');

    // Calculate distances and filter by radius
    const nearbyPharmacies = pharmacies.map(pharmacy => {
      const distance = calculateDistance(
        parseFloat(latitude),
        parseFloat(longitude),
        pharmacy.location.coordinates.latitude,
        pharmacy.location.coordinates.longitude
      );

      return {
        id: pharmacy._id,
        name: pharmacy.name,
        address: pharmacy.location.address,
        phone: pharmacy.pharmacyDetails.phone,
        operatingHours: pharmacy.pharmacyDetails.operatingHours,
        services: pharmacy.pharmacyDetails.services,
        distance: Math.round(distance * 10) / 10, // Round to 1 decimal
        coordinates: pharmacy.location.coordinates,
      };
    }).filter(pharmacy => pharmacy.distance <= parseFloat(radius))
      .sort((a, b) => a.distance - b.distance);

    res.json(nearbyPharmacies);
  } catch (error) {
    console.error('Error fetching nearby pharmacies:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update patient location
router.post('/location', verifyToken, async (req, res) => {
  try {
    const { latitude, longitude, address } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ message: 'Latitude and longitude required' });
    }

    await User.findByIdAndUpdate(req.user.id, {
      'location.coordinates': { latitude, longitude },
      'location.address': address,
      'location.lastUpdated': new Date(),
    });

    res.json({ message: 'Location updated successfully' });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Place an order to a specific pharmacy
router.post('/orders', verifyToken, async (req, res) => {
  try {
    const {
      pharmacyId,
      items,
      deliveryAddress,
      prescription,
      notes,
      priority = 'normal'
    } = req.body;

    // Validate pharmacy exists and is active
    const pharmacy = await User.findOne({
      _id: pharmacyId,
      role: 'pharmacy',
      'pharmacyDetails.isActive': true
    });

    if (!pharmacy) {
      return res.status(404).json({ message: 'Pharmacy not found or inactive' });
    }

    // Get patient details
    const patient = await User.findById(req.user.id).select('name email location');

    // Generate order ID
    const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

    // Create order
    const order = new Order({
      orderId,
      patient: {
        id: patient._id,
        name: patient.name,
        email: patient.email,
        location: patient.location?.coordinates,
        address: patient.location?.address,
      },
      pharmacy: {
        id: pharmacy._id,
        name: pharmacy.name,
        address: pharmacy.location?.address,
        phone: pharmacy.pharmacyDetails?.phone,
        location: pharmacy.location?.coordinates,
      },
      items,
      deliveryAddress,
      prescription,
      notes,
      priority,
      status: 'placed',
      timeline: [{
        status: 'placed',
        actor: patient._id,
        notes: 'Order placed by patient',
      }],
    });

    await order.save();

    // Update pharmacy metrics
    await User.findByIdAndUpdate(pharmacyId, {
      $inc: { 'pharmacyMetrics.ordersHandled': 1 },
      $push: {
        activityLogs: {
          eventType: 'order',
          title: 'New Order Received',
          description: `Order ${orderId} placed by ${patient.name}`,
          orderId: orderId,
          timestamp: new Date(),
        }
      }
    });

    // Send real-time notifications
    NotificationService.orderPlaced(order, patient._id);

    res.status(201).json({
      message: 'Order placed successfully',
      orderId: order.orderId,
      pharmacy: {
        name: pharmacy.name,
        address: pharmacy.location?.address,
      }
    });
  } catch (error) {
    console.error('Error placing order:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get patient's orders
router.get('/orders', verifyToken, async (req, res) => {
  try {
    const orders = await Order.find({ 'patient.id': req.user.id })
      .sort({ createdAt: -1 })
      .select('orderId status pharmacy logistics items deliveryAddress createdAt updatedAt');

    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get order details
router.get('/orders/:orderId', verifyToken, async (req, res) => {
  try {
    const order = await Order.findOne({
      orderId: req.params.orderId,
      'patient.id': req.user.id
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper function to calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon/2) * Math.sin(dLon/2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

export default router;