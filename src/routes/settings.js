const express = require('express');
const router = express.Router();
const path = require('path');
const { getDisplayDecimalPlaces, setDisplayDecimalPlaces, setTenantSettings } = require('../models/tenant');
const { isAuthenticated, isAdmin } = require('../middlewares/auth');
const db = require('../db');

// Render the settings page
router.get('/', isAuthenticated, isAdmin, (req, res) => {
  console.log('GET /settings called. Session:', req.session && req.session.user);
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).render('error', { message: 'Forbidden', error: { status: 403, stack: 'You are not authorized to view this page.' } });
  }
  // Fetch latest tenant info from DB
  const tenantUid = req.session.user.tenant_uid;
  const tenant = db.get('SELECT tenant_uid, name, currency, timezone FROM tenant WHERE tenant_uid = ?', [tenantUid]);
  // Merge with session user info for email, role, etc.
  const user = {
    ...req.session.user,
    tenant_uid: tenant.tenant_uid,
    tenant_name: tenant.name,
    currency: tenant.currency,
    timezone: tenant.timezone
  };
  res.render('settings', { user, csrfToken: req.csrfToken && req.csrfToken() });
});

// GET: Get tenant display decimal places
router.get('/display-decimal-places', isAuthenticated, isAdmin, (req, res) => {
  console.log('GET /settings/display-decimal-places called. Session:', req.session && req.session.user);
  const tenantUid = req.session.user ? req.session.user.tenant_uid : null;
  console.log('GET /settings/display-decimal-places tenantUid:', tenantUid);
  if (!tenantUid) {
    console.error('No tenantUid found in session.user');
    return res.status(400).json({ error: 'No tenantUid found in session.user' });
  }
  try {
    const dp = getDisplayDecimalPlaces(tenantUid);
    res.json({ display_decimal_places: dp });
  } catch (err) {
    console.error('Error in GET /settings/display-decimal-places:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST: Set tenant display decimal places
router.post('/display-decimal-places', isAuthenticated, isAdmin, (req, res) => {
  console.log('POST /settings/display-decimal-places called. Session:', req.session && req.session.user, 'Body:', req.body);
  const tenantUid = req.session.user ? req.session.user.tenant_uid : null;
  console.log('POST /settings/display-decimal-places tenantUid:', tenantUid, 'body:', req.body);
  try {
    let { display_decimal_places, company_name } = req.body;
    display_decimal_places = parseInt(display_decimal_places, 10);
    setTenantSettings(tenantUid, { display_decimal_places, company_name });
    res.json({ success: true, display_decimal_places, company_name });
  } catch (err) {
    console.error('Error in POST /settings/display-decimal-places:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router; 