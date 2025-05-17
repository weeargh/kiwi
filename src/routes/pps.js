const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middlewares/auth');
const ppsModel = require('../models/pps');
const decimal = require('../utils/decimal');
const dateUtils = require('../utils/date');
const validation = require('../utils/validation');
const { handleError } = require('../utils/response');
const { getDisplayDecimalPlaces } = require('../models/tenant');

// Validation schema
const ppsSchema = {
  pricePerShare: {
    type: 'number',
    required: true,
    positive: true,
    decimalPlaces: true,
    label: 'Price Per Share'
  },
  effectiveDate: {
    type: 'date',
    required: true,
    label: 'Effective Date'
  }
};

// GET /pps - Display PPS history page
router.get('/', isAuthenticated, isAdmin, (req, res) => {
  try {
    const tenantUid = req.tenantUid;
    const timezone = req.session.user.timezone;
    const decimalPlaces = getDisplayDecimalPlaces(tenantUid);
    
    // Get pagination parameters
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    
    // Get PPS history
    let history = ppsModel.getPPSHistory(tenantUid, limit, offset);
    if (!Array.isArray(history)) history = history ? [history] : [];
    const totalCount = ppsModel.countPPSHistory(tenantUid);
    
    // Get current PPS
    const currentPPS = ppsModel.getCurrentPPS(tenantUid);
    
    // Format history for display
    const formattedHistory = history.map(pps => ({
      uid: pps.pps_uid,
      effectiveDate: dateUtils.formatDate(pps.effective_date, timezone),
      pricePerShare: decimal.format(pps.price_per_share),
      createdAt: dateUtils.formatDate(pps.created_at, timezone),
      createdBy: pps.created_by_name,
      isCurrent: currentPPS && pps.pps_uid === currentPPS.uid
    }));
    
    // Format current PPS for display
    let formattedCurrentPPS = null;
    if (currentPPS) {
      formattedCurrentPPS = {
        uid: currentPPS.uid,
        effectiveDate: dateUtils.formatDate(currentPPS.effectiveDate, timezone),
        pricePerShare: decimal.format(currentPPS.pricePerShare)
      };
    }
    
    // Calculate pagination
    const totalPages = Math.ceil(totalCount / limit);
    const pagination = {
      current: page,
      total: totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      next: page + 1,
      prev: page - 1
    };
    
    // Render the PPS page
    res.render('pps/index', {
      title: 'Price Per Share',
      history: formattedHistory,
      currentPPS: formattedCurrentPPS,
      pagination,
      currency: req.session.user.currency,
      decimalPlaces
    });
  } catch (err) {
    console.error('Error fetching PPS history:', err);
    res.render('pps/index', {
      title: 'Price Per Share',
      error: 'An error occurred while loading PPS data',
      history: [],
      currentPPS: null,
      pagination: { current: 1, total: 1 },
      currency: req.session.user.currency,
      decimalPlaces: 0
    });
  }
});

// POST /pps - Create a new PPS record
router.post('/', isAuthenticated, isAdmin, (req, res) => {
  try {
    const tenantUid = req.tenantUid;
    const userUid = req.session.user.user_uid;
    const { pricePerShare, effectiveDate } = req.body;
    console.log('[PPS DEBUG] POST /pps:', { tenantUid, userUid, pricePerShare, effectiveDate });
    
    // Validate input
    const { valid, errors } = validation.validateForm(req.body, ppsSchema);
    if (!valid) {
      return res.render('pps/index', {
        title: 'Price Per Share',
        error: 'Please correct the errors below',
        validationErrors: errors,
        formValues: req.body,
        history: [],  // Will be reloaded on redirect
        currentPPS: null,  // Will be reloaded on redirect
        pagination: { current: 1, total: 1 },
        currency: req.session.user.currency
      });
    }
    
    // Create the PPS record
    ppsModel.createPPS(tenantUid, pricePerShare, effectiveDate, userUid);
    
    // Redirect to refresh the page
    res.redirect('/pps?success=Price+per+share+updated+successfully');
  } catch (err) {
    console.error('Error creating PPS record:', err);
    
    // Redirect with error message
    res.redirect(`/pps?error=${encodeURIComponent(err.message || 'Error creating PPS record')}`);
  }
});

// GET /pps/current - Get current PPS (API)
router.get('/current', isAuthenticated, (req, res) => {
  try {
    const tenantUid = req.tenantUid;
    
    // Get current PPS
    const currentPPS = ppsModel.getCurrentPPS(tenantUid);
    
    if (!currentPPS) {
      return res.status(404).json({ 
        success: false, 
        error: 'No PPS records found' 
      });
    }
    
    // Format the response
    const response = {
      uid: currentPPS.uid,
      effectiveDate: currentPPS.effectiveDate,
      pricePerShare: decimal.format(currentPPS.pricePerShare),
      currency: req.session.user.currency
    };
    
    res.json({ success: true, data: response });
  } catch (err) {
    return handleError(err, res);
  }
});

// DELETE /pps/:pps_uid - Delete a PPS record
router.delete('/:pps_uid', isAuthenticated, isAdmin, (req, res) => {
  try {
    const ppsUid = req.params.pps_uid;
    const tenantUid = req.tenantUid;
    const userUid = req.session.user.user_uid;
    
    // Delete the PPS record
    ppsModel.deletePPS(ppsUid, tenantUid, userUid);
    
    res.json({ success: true });
  } catch (err) {
    return handleError(err, res);
  }
});

// GET /pps/:date - Get PPS for a specific date (API)
router.get('/:date', isAuthenticated, (req, res) => {
  try {
    const date = req.params.date;
    const tenantUid = req.tenantUid;
    
    // Validate date format
    if (!validation.isValidDateFormat(date)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid date format. Use YYYY-MM-DD' 
      });
    }
    
    // Get PPS for the specified date
    const pps = ppsModel.getPPSForDate(tenantUid, date);
    
    if (!pps) {
      return res.status(404).json({ 
        success: false, 
        error: 'No PPS record found for the specified date' 
      });
    }
    
    // Format the response
    const response = {
      uid: pps.uid,
      effectiveDate: pps.effectiveDate,
      pricePerShare: decimal.format(pps.pricePerShare),
      currency: req.session.user.currency
    };
    
    res.json({ success: true, data: response });
  } catch (err) {
    return handleError(err, res);
  }
});

// POST /pps/refresh-vesting-pps - Refresh PPS for all vesting events for this tenant
router.post('/refresh-vesting-pps', isAuthenticated, isAdmin, (req, res) => {
  try {
    const tenantUid = req.tenantUid;
    const updated = ppsModel.refreshVestingEventPPS(tenantUid);
    res.json({ success: true, updated });
  } catch (err) {
    console.error('[PPS] Error refreshing vesting event PPS:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router; 