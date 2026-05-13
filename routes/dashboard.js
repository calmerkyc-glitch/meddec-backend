import express from 'express';
import { verifyToken } from '../utils/authMiddleware.js';

const router = express.Router();

router.use(verifyToken);

const defaultQuickStats = (user) => {
  const activePrescriptions = (user.prescriptions || []).length;
  const pendingRefills = (user.refills || []).filter((item) => ['Processing', 'Scheduled', 'Ready for pickup'].includes(item.status)).length;
  const upcomingConsultations = (user.consultations || []).filter((item) => ['Upcoming', 'Confirmed'].includes(item.status)).length;
  const deliveryStatus = user.refills && user.refills.length ? user.refills[0].status : 'No deliveries';

  return [
    { label: 'Active Prescriptions', value: `${activePrescriptions}`, detail: 'Your current medication count' },
    { label: 'Pending Refills', value: `${pendingRefills}`, detail: 'Refill requests needing attention' },
    { label: 'Upcoming Consultations', value: `${upcomingConsultations}`, detail: 'Visits scheduled soon' },
    { label: 'Delivery Status', value: deliveryStatus, detail: user.refills && user.refills[0] ? `Next: ${user.refills[0].medicine}` : 'No active deliveries' },
  ];
};

const sampleOrder = {
  id: 'MD-99201',
  eta: 'Tomorrow, Oct 14',
  progress: ['Processed', 'In Transit', 'Delivery'],
  activeStep: 2,
};

const sampleActivity = [
  { title: 'Prescription renewed', subtitle: 'Atorvastatin 20mg approved by Dr. Mitchell.', time: 'Oct 12, 09:15 AM' },
  { title: 'Lab results ready', subtitle: 'Your blood panel results are available for review.', time: 'Oct 11, 04:30 PM' },
  { title: 'Security update', subtitle: 'Password changed successfully.', time: 'Oct 10, 11:22 AM' },
];

router.get('/overview', (req, res) => {
  const userId = req.user._id.toString().slice(-6).toUpperCase();
  const patientId = `#${userId}`;
  const prescriptions = req.user.prescriptions || [];
  const consultations = req.user.consultations || [];

  const action = prescriptions[0] || {
    medicine: 'Lisinopril 10mg',
    description: 'Daily for hypertension',
    note: 'Only 4 days remaining',
    status: 'Urgent',
  };

  const nextConsultation = consultations.find((item) => item.status === 'Upcoming') || consultations[0] || {
    time: 'No upcoming consultation',
    doctor: 'TBD',
    specialty: 'General Care',
    status: 'N/A',
  };

  res.json({
    patientId,
    quickStats: defaultQuickStats(req.user),
    prescriptions: req.user.prescriptions || [],
    refills: req.user.refills || [],
    records: (req.user.records || []).slice(0, 3),
    action,
    consultation: {
      ...nextConsultation,
      specialty: nextConsultation.specialty ? `${nextConsultation.specialty} Specialist` : 'Specialist',
    },
    order: sampleOrder,
    activity: sampleActivity,
  });
});

router.get('/prescriptions', (req, res) => {
  res.json({ prescriptions: req.user.prescriptions || [] });
});

router.get('/refills', (req, res) => {
  res.json({ refills: req.user.refills || [] });
});

router.post('/refill-request', async (req, res) => {
  try {
    const { medicine } = req.body;
    if (!medicine) {
      return res.status(400).json({ error: 'Medicine is required for refill request' });
    }

    const existing = (req.user.refills || []).find((item) => item.medicine === medicine);
    if (existing) {
      existing.status = 'Processing';
      existing.eta = 'Today';
    } else {
      req.user.refills = [
        ...(req.user.refills || []),
        { medicine, status: 'Processing', eta: 'Today' },
      ];
    }

    await req.user.save();
    res.json({ message: 'Refill request sent', refills: req.user.refills });
  } catch (error) {
    console.error('Refill request failed:', error.message);
    res.status(500).json({ error: 'Unable to submit refill request' });
  }
});

router.get('/refills/:medicine', (req, res) => {
  const medicineName = decodeURIComponent(req.params.medicine);
  const item = (req.user.refills || []).find((refill) => refill.medicine === medicineName);
  if (!item) {
    return res.status(404).json({ error: 'Refill not found' });
  }
  res.json({ refill: item });
});

router.get('/consultations', (req, res) => {
  res.json({ consultations: req.user.consultations || [] });
});

router.post('/consultations/join', async (req, res) => {
  try {
    const { time } = req.body;
    if (!time) {
      return res.status(400).json({ error: 'Consultation time is required' });
    }

    const consultation = (req.user.consultations || []).find((item) => item.time === time);
    if (!consultation) {
      return res.status(404).json({ error: 'Consultation not found' });
    }

    consultation.status = 'In Progress';
    await req.user.save();
    res.json({ message: 'Consultation joined', consultations: req.user.consultations });
  } catch (error) {
    console.error('Join consultation failed:', error.message);
    res.status(500).json({ error: 'Unable to join consultation' });
  }
});

router.get('/records', (req, res) => {
  res.json({ records: req.user.records || [] });
});

router.get('/records/:title', (req, res) => {
  const title = decodeURIComponent(req.params.title);
  const record = (req.user.records || []).find((item) => item.title === title);
  if (!record) {
    return res.status(404).json({ error: 'Record not found' });
  }
  res.json({ record });
});

export default router;
