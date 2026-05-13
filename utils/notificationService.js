import { io } from '../server.js';

class NotificationService {
  // Send notification to specific user
  static notifyUser(userId, event, data) {
    io.to(`user_${userId}`).emit(event, data);
  }

  // Send notification to all users with specific role
  static notifyRole(role, event, data) {
    io.to(`role_${role}`).emit(event, data);
  }

  // Send notification to order subscribers
  static notifyOrder(orderId, event, data) {
    io.to(`order_${orderId}`).emit(event, data);
  }

  // Broadcast to all connected clients
  static broadcast(event, data) {
    io.emit(event, data);
  }

  // Order-related notifications
  static orderPlaced(order, patientId) {
    const notification = {
      type: 'order_placed',
      title: 'Order Placed Successfully',
      message: `Your order ${order.orderId} has been placed and sent to ${order.pharmacy.name}`,
      orderId: order.orderId,
      timestamp: new Date(),
      data: order
    };

    this.notifyUser(patientId, 'notification', notification);
    this.notifyRole('pharmacy', 'new_order', {
      ...notification,
      pharmacyId: order.pharmacy.id
    });
  }

  static orderStatusUpdate(order, userId, role) {
    const notification = {
      type: 'order_status_update',
      title: `Order ${order.status.charAt(0).toUpperCase() + order.status.slice(1)}`,
      message: this.getStatusMessage(order.status, role),
      orderId: order.orderId,
      status: order.status,
      timestamp: new Date(),
      data: order
    };

    this.notifyUser(userId, 'notification', notification);
    this.notifyOrder(order.orderId, 'order_update', notification);
  }

  static pharmacyResponse(order, patientId, accepted) {
    const notification = {
      type: accepted ? 'order_accepted' : 'order_rejected',
      title: accepted ? 'Order Accepted' : 'Order Rejected',
      message: accepted
        ? `${order.pharmacy.name} has accepted your order and will prepare it soon.`
        : `${order.pharmacy.name} has rejected your order. Please contact them for details.`,
      orderId: order.orderId,
      timestamp: new Date(),
      data: order
    };

    this.notifyUser(patientId, 'notification', notification);
    this.notifyOrder(order.orderId, 'order_update', notification);
  }

  static logisticsAssigned(order, patientId, logisticsId) {
    const notification = {
      type: 'logistics_assigned',
      title: 'Delivery Driver Assigned',
      message: `${order.logistics.name} has been assigned to deliver your order.`,
      orderId: order.orderId,
      timestamp: new Date(),
      data: order
    };

    this.notifyUser(patientId, 'notification', notification);
    this.notifyUser(logisticsId, 'new_delivery', {
      ...notification,
      logisticsId: logisticsId
    });
    this.notifyOrder(order.orderId, 'order_update', notification);
  }

  static deliveryUpdate(order, patientId, status, eta) {
    const notification = {
      type: 'delivery_update',
      title: this.getDeliveryStatusTitle(status),
      message: this.getDeliveryStatusMessage(status, eta),
      orderId: order.orderId,
      status: status,
      eta: eta,
      timestamp: new Date(),
      data: order
    };

    this.notifyUser(patientId, 'notification', notification);
    this.notifyOrder(order.orderId, 'order_update', notification);
  }

  static deliveryCompleted(order, patientId, logisticsId) {
    const notification = {
      type: 'delivery_completed',
      title: 'Order Delivered',
      message: `Your order ${order.orderId} has been successfully delivered!`,
      orderId: order.orderId,
      timestamp: new Date(),
      data: order
    };

    this.notifyUser(patientId, 'notification', notification);
    this.notifyUser(logisticsId, 'delivery_completed', notification);
    this.notifyOrder(order.orderId, 'order_update', notification);
  }

  // Helper methods for status messages
  static getStatusMessage(status, role) {
    const messages = {
      patient: {
        confirmed: 'Your order has been confirmed by the pharmacy.',
        preparing: 'Your order is being prepared.',
        ready: 'Your order is ready for pickup/delivery.',
        picked_up: 'Your order has been picked up for delivery.',
        in_transit: 'Your order is on the way!',
        delivered: 'Your order has been delivered successfully.',
        cancelled: 'Your order has been cancelled.'
      },
      pharmacy: {
        placed: 'New order received.',
        confirmed: 'Order confirmed and being prepared.',
        ready: 'Order ready for pickup.',
        picked_up: 'Order picked up by logistics.',
        delivered: 'Order delivered successfully.',
        cancelled: 'Order cancelled.'
      },
      logistics: {
        ready: 'New delivery assignment available.',
        picked_up: 'Order picked up successfully.',
        in_transit: 'Order in transit to delivery address.',
        delivered: 'Order delivered successfully.',
        cancelled: 'Order cancelled.'
      }
    };

    return messages[role]?.[status] || `Order status updated to: ${status}`;
  }

  static getDeliveryStatusTitle(status) {
    const titles = {
      assigned: 'Driver Assigned',
      picked_up: 'Order Picked Up',
      in_transit: 'Out for Delivery',
      delivered: 'Delivered'
    };
    return titles[status] || 'Delivery Update';
  }

  static getDeliveryStatusMessage(status, eta) {
    const messages = {
      assigned: 'Your delivery driver has been assigned.',
      picked_up: 'Your order has been picked up and is on the way.',
      in_transit: eta ? `Your order is on the way! Estimated delivery: ${eta}` : 'Your order is on the way!',
      delivered: 'Your order has been delivered successfully!'
    };
    return messages[status] || 'Delivery status updated.';
  }

  // Chat-related notifications
  static sendChatNotification(chat, sender, recipientId) {
    const notification = {
      type: 'chat_invitation',
      title: 'New Chat Started',
      message: `${sender.name} started a chat regarding order ${chat.orderId}`,
      chatId: chat._id,
      orderId: chat.orderId,
      senderName: sender.name,
      senderRole: sender.role,
      timestamp: new Date()
    };

    this.notifyUser(recipientId, 'chat_invitation', notification);
  }

  static sendChatMessageNotification(chat, message, recipientId) {
    const notification = {
      type: 'new_chat_message',
      title: 'New Message',
      message: `${message.senderName}: ${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}`,
      chatId: chat._id,
      orderId: chat.orderId,
      senderName: message.senderName,
      senderRole: message.senderRole,
      timestamp: new Date()
    };

    this.notifyUser(recipientId, 'new_chat_message', notification);
  }

  static sendCallRequestNotification(order, requester, recipientId, recipientRole) {
    const notification = {
      type: 'call_request',
      title: 'Call Request',
      message: `${requester.name} is requesting a call regarding order ${order.orderId}`,
      orderId: order.orderId,
      requesterName: requester.name,
      requesterRole: requester.role,
      targetRole: recipientRole,
      timestamp: new Date()
    };

    this.notifyUser(recipientId, 'call_request', notification);
  }
}

export default NotificationService;