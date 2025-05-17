const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middlewares/auth');
const poolModel = require('../models/pool');
const db = require('../db');
const decimal = require('../utils/decimal');
const dateUtils = require('../utils/date');
const validation = require('../utils/validation');
const { handleError } = require('../utils/response');
const { getDisplayDecimalPlaces } = require('../models/tenant');
const { formatForTenantDisplay } = require('../utils/formatForTenantDisplay');

// Validation schemas
const poolEventSchema = {
  amount: {
    type: 'number',
    required: true,
    decimalPlaces: true,
    label: 'Amount'
  },
  eventType: {
    type: 'poolEventType',
    required: true,
    label: 'Event Type'
  },
  effectiveDate: {
    type: 'date',
    required: true,
    label: 'Effective Date'
  },
  notes: {
    type: 'string',
    maxLength: 500,
    label: 'Notes'
  }
};

// GET /pools - Display equity pool page
router.get('/', isAuthenticated, isAdmin, (req, res) => {
  console.log('ROUTE /pools HIT');
  try {
    const tenantUid = req.tenantUid;
    const timezone = req.session.user.timezone;
    // Debug logs for troubleshooting
    console.log('DEBUG: Tenant UID in /pools route:', tenantUid);
    // Fetch tenant decimal setting
    const decimalPlaces = getDisplayDecimalPlaces(tenantUid);
    // Get pool data
    const pool = poolModel.getPool(tenantUid);
    console.log('DEBUG: Pool found for tenant:', pool);
    if (!pool) {
      return res.render('pools/index', {
        title: 'Equity Pool',
        pool: null,
        events: [],
        decimalPlaces
      });
    }
    // Format pool data for display
    const formattedPool = {
      uid: pool.uid,
      initialAmount: formatForTenantDisplay(pool.initialAmount, decimalPlaces),
      totalPool: formatForTenantDisplay(pool.totalPool, decimalPlaces),
      granted: formatForTenantDisplay(pool.granted, decimalPlaces),
      returned: formatForTenantDisplay(pool.returned, decimalPlaces),
      available: formatForTenantDisplay(pool.available, decimalPlaces),
      unvestedSharesReturned: formatForTenantDisplay(pool.unvestedSharesReturned, decimalPlaces),
      vestedSharesReturned: formatForTenantDisplay(pool.vestedSharesReturned, decimalPlaces),
      keptByEmployee: formatForTenantDisplay(pool.keptByEmployee, decimalPlaces)
    };
    // Get pool events
    let events = poolModel.getPoolEvents(pool.uid, tenantUid);
    if (!Array.isArray(events)) events = events ? [events] : [];
    // Only include pool-size-changing events
    events = events.filter(e => ['initial', 'top_up', 'reduction'].includes(e.event_type));
    // Format events for display
    const formattedEvents = events.map(event => ({
      uid: event.event_uid,
      amount: formatForTenantDisplay(event.amount, decimalPlaces),
      eventType: event.event_type,
      effectiveDate: dateUtils.formatDate(event.effective_date, timezone),
      notes: event.notes,
      createdAt: dateUtils.formatDate(event.created_at, timezone),
      createdBy: event.created_by_name
    }));
    // Render the pool page
    res.render('pools/index', {
      title: 'Equity Pool',
      pool: formattedPool,
      events: formattedEvents,
      decimalPlaces,
      tenantUid,
    });
  } catch (err) {
    console.error('Error fetching pool data:', err);
    res.render('pools/index', {
      title: 'Equity Pool',
      error: 'An error occurred while loading equity pool data',
      pool: null,
      events: [],
      decimalPlaces: 0
    });
  }
});

// GET /pools/:pool_uid/events - List all events for a pool
router.get('/:pool_uid/events', isAuthenticated, isAdmin, (req, res) => {
  try {
    const poolUid = req.params.pool_uid;
    const tenantUid = req.tenantUid;
    // Get pool events
    let events = poolModel.getPoolEvents(poolUid, tenantUid);
    if (!Array.isArray(events)) events = events ? [events] : [];
    // Format events for display
    const timezone = req.session.user.timezone;
    const formattedEvents = events.map(event => ({
      uid: event.event_uid,
      amount: decimal.format(event.amount),
      eventType: event.event_type,
      effectiveDate: dateUtils.formatDate(event.effective_date, timezone),
      notes: event.notes,
      createdAt: dateUtils.formatDate(event.created_at, timezone),
      createdBy: event.created_by_name
    }));
    res.json({ success: true, data: formattedEvents });
  } catch (err) {
    handleError(err, res);
  }
});

// POST /pools/:pool_uid/events - Add a pool event
router.post('/:pool_uid/events', isAuthenticated, isAdmin, (req, res) => {
  try {
    const poolUid = req.params.pool_uid;
    const tenantUid = req.tenantUid;
    const userUid = req.session.user.user_uid;
    const { amount, eventType, effectiveDate, notes } = req.body;
    // Convert amount based on event type
    let eventAmount = parseFloat(amount);
    if (eventType === 'reduction') {
      eventAmount = -Math.abs(eventAmount); // Ensure negative for reduction
    }
    // Add the pool event
    poolModel.addPoolEvent(
      poolUid,
      tenantUid,
      eventAmount,
      eventType,
      effectiveDate,
      notes,
      userUid
    );
    res.redirect('/pools'); // Redirect to the pools page on success
  } catch (err) {
    console.error('Error adding pool event:', err); // Keep logging

    const poolUid = req.params.pool_uid;
    const tenantUid = req.tenantUid;
    const formValues = req.body; // User's submitted data
    let errorResponse = 'Failed to add pool event. Please try again.';
    let validationErrors = {};

    if (err.name === 'ValidationError' && err.details) {
      errorResponse = err.message || 'Validation failed. Please check your input.';
      validationErrors = err.details;
    } else if (err.message) {
      errorResponse = err.message; // Use error message if available
    }

    // Fetch data needed to re-render the page, similar to the GET '/pools' route
    try {
      const timezone = req.session.user.timezone;
      const decimalPlaces = getDisplayDecimalPlaces(tenantUid);
      const poolData = poolModel.getPool(tenantUid); // Assuming getPool uses tenantUid

      if (!poolData) {
        // This case should ideally not happen if we are adding an event to an existing pool
        // But as a fallback, render with an error.
        return res.status(404).render('error', { message: 'Pool not found.', error: err });
      }

      const formattedPool = {
        uid: poolData.uid,
        initialAmount: formatForTenantDisplay(poolData.initialAmount, decimalPlaces),
        totalPool: formatForTenantDisplay(poolData.totalPool, decimalPlaces),
        granted: formatForTenantDisplay(poolData.granted, decimalPlaces),
        returned: formatForTenantDisplay(poolData.returned, decimalPlaces),
        available: formatForTenantDisplay(poolData.available, decimalPlaces),
        unvestedSharesReturned: formatForTenantDisplay(poolData.unvestedSharesReturned, decimalPlaces),
        vestedSharesReturned: formatForTenantDisplay(poolData.vestedSharesReturned, decimalPlaces),
        keptByEmployee: formatForTenantDisplay(poolData.keptByEmployee, decimalPlaces)
      };

      let events = poolModel.getPoolEvents(poolData.uid, tenantUid);
      if (!Array.isArray(events)) events = events ? [events] : [];
      events = events.filter(e => ['initial', 'top_up', 'reduction'].includes(e.event_type));
      const formattedEvents = events.map(event => ({
        uid: event.event_uid,
        amount: formatForTenantDisplay(event.amount, decimalPlaces),
        eventType: event.event_type,
        effectiveDate: dateUtils.formatDate(event.effective_date, timezone),
        notes: event.notes,
        createdAt: dateUtils.formatDate(event.created_at, timezone),
        createdBy: event.created_by_name
      }));
      
      // Add csrfToken if it's not automatically added by middleware for re-renders
      const csrfToken = req.csrfToken ? req.csrfToken() : null;


      res.status(err.name === 'ValidationError' ? 400 : 500).render('pools/index', {
        title: 'Equity Pool',
        pool: formattedPool,
        events: formattedEvents,
        decimalPlaces,
        tenantUid,
        error: errorResponse, // General error message for the page
        validationErrors,    // Specific field validation errors
        formValues,          // To repopulate the form
        csrfToken            // Pass CSRF token for the form
      });
    } catch (renderError) {
      console.error('Error re-rendering pool page after event error:', renderError);
      // Fallback to generic error page if re-rendering fails
      res.status(500).render('error', { message: 'An unexpected error occurred.', error: renderError });
    }
  }
});

// GET /pools/events/:event_uid - Get pool event details (API)
router.get('/events/:event_uid', isAuthenticated, isAdmin, (req, res) => {
  try {
    const eventUid = req.params.event_uid;
    const tenantUid = req.tenantUid;
    
    // Get event details
    const event = db.query(
      `SELECT 
        e.event_uid, 
        e.pool_uid,
        e.amount, 
        e.event_type, 
        e.effective_date, 
        e.notes, 
        e.created_at,
        u.name as created_by_name
      FROM pool_event e
      JOIN user_account u ON e.created_by = u.user_uid
      WHERE e.event_uid = ? AND e.tenant_uid = ?`,
      [eventUid, tenantUid]
    );
    
    if (!event || event.length === 0) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }
    
    // Format the event
    const formattedEvent = {
      uid: event[0].event_uid,
      poolUid: event[0].pool_uid,
      amount: decimal.format(event[0].amount),
      eventType: event[0].event_type,
      effectiveDate: event[0].effective_date,
      notes: event[0].notes,
      createdAt: event[0].created_at,
      createdBy: event[0].created_by_name
    };
    
    res.json({ success: true, data: formattedEvent });
  } catch (err) {
    handleError(err, res);
  }
});

// GET /pools/:tenant_uid/returned-shares-history - API: Returned shares history for a tenant
router.get('/:tenant_uid/returned-shares-history', isAuthenticated, isAdmin, (req, res) => {
  try {
    const tenantUid = req.params.tenant_uid;
    const db = require('../db');
    const events = db.query(
      `SELECT event_uid, pool_uid, amount, event_type, effective_date, notes, created_at, created_by
       FROM pool_event
       WHERE tenant_uid = ? AND event_type IN ('return_vested', 'return_unvested')
       ORDER BY created_at ASC`,
      [tenantUid]
    );
    res.json({ success: true, data: events });
  } catch (err) {
    console.error('Error fetching returned shares history:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch returned shares history' });
  }
});

// UI page route for Equity Ledger
router.get('/:tenant_uid/ledger', isAuthenticated, isAdmin, (req, res) => {
  const tenantUid = req.params.tenant_uid;
  const decimalPlaces = getDisplayDecimalPlaces(tenantUid);
  res.render('pools/ledger', { title: 'Equity Ledger', decimalPlaces });
});

// API endpoint for ledger data (renamed to avoid conflict)
router.get('/:tenant_uid/ledger/data', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const tenantUid = req.params.tenant_uid;
    const db = require('../db');
    // Pool events (top-up, reduction, initial, returned, etc.)
    const poolEvents = db.query(
      `SELECT 
         e.effective_date,
         e.created_at,
         e.event_type as type,
         e.amount,
         e.employee_uid,
         emp.first_name || ' ' || emp.last_name as employee_name,
         u.name as performed_by,
         e.notes,
         e.grant_uid as reference_uid,
         'pool_event' as source
       FROM pool_event e
       LEFT JOIN employee emp ON e.employee_uid = emp.employee_uid
       JOIN user_account u ON e.created_by = u.user_uid
       WHERE e.tenant_uid = ?
      `,
      [tenantUid]
    );
    console.log(`[LEDGER DEBUG] tenantUid=${tenantUid} poolEvents count:`, poolEvents.length, poolEvents);
    // Grant creation (Granted)
    const grantEvents = db.query(
      `SELECT 
         g.grant_date as effective_date,
         g.created_at,
         'granted' as type,
         g.share_amount as amount,
         g.employee_uid,
         emp.first_name || ' ' || emp.last_name as employee_name,
         u.name as performed_by,
         NULL as notes,
         g.grant_uid as reference_uid,
         'grant' as source
       FROM grant_record g
       JOIN user_account u ON g.created_by = u.user_uid
       JOIN employee emp ON g.employee_uid = emp.employee_uid
       WHERE g.tenant_uid = ? AND g.deleted_at IS NULL
      `,
      [tenantUid]
    );
    console.log(`[LEDGER DEBUG] tenantUid=${tenantUid} grantEvents count:`, grantEvents.length, grantEvents);
    // Combine and sort all events by effective_date DESC, then created_at DESC
    const allEvents = [...poolEvents, ...grantEvents];

    // Add derived 'Kept by Employee' entries
    const keptGrants = db.query(`
      SELECT g.grant_uid, g.employee_uid, g.grant_date, g.share_amount, g.vested_shares_returned, g.status, g.inactive_effective_date, g.terminated_at, e.first_name, e.last_name
      FROM grant_record g
      JOIN employee e ON g.employee_uid = e.employee_uid
      WHERE g.tenant_uid = ? AND (g.status = 'terminated' OR g.status = 'inactive') AND g.deleted_at IS NULL
    `, [tenantUid]);
    console.log(`[LEDGER DEBUG] tenantUid=${tenantUid} keptGrants count:`, keptGrants.length, keptGrants);
    keptGrants.forEach(grant => {
      const effectiveDate = grant.inactive_effective_date || grant.terminated_at;
      if (!effectiveDate) return;
      // Use actual vested shares from vesting_event up to and including the effective date
      const vestedRow = db.get(
        'SELECT SUM(shares_vested) as vested FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ? AND vest_date <= ?',
        [grant.grant_uid, tenantUid, effectiveDate]
      );
      const vested = parseFloat(vestedRow && vestedRow.vested ? vestedRow.vested : 0);
      const returnedVested = parseFloat(grant.vested_shares_returned || 0);
      const kept = Math.max(0, vested - returnedVested);
      if (kept > 0.001) {
        allEvents.push({
          effective_date: effectiveDate,
          created_at: effectiveDate,
          type: 'kept_by_employee',
          amount: kept,
          employee_uid: grant.employee_uid,
          employee_name: `${grant.first_name} ${grant.last_name}`,
          performed_by: '',
          notes: '',
          reference_uid: grant.grant_uid,
          source: 'derived'
        });
      }
    });
    allEvents.sort((a, b) => {
      if (a.effective_date > b.effective_date) return -1;
      if (a.effective_date < b.effective_date) return 1;
      if (a.created_at > b.created_at) return -1;
      if (a.created_at < b.created_at) return 1;
      return 0;
    });
    console.log(`[LEDGER DEBUG] tenantUid=${tenantUid} allEvents count:`, allEvents.length, allEvents);
    res.json({ success: true, data: allEvents });
  } catch (err) {
    console.error('Error fetching equity ledger:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch equity ledger' });
  }
});

// POST /pools/create-initial - Create initial equity pool if missing
router.post('/create-initial', isAuthenticated, isAdmin, (req, res) => {
  try {
    const tenantUid = req.tenantUid;
    const userUid = req.session.user.user_uid;
    const initialAmount = parseFloat(req.body.initialAmount);
    console.log('[CREATE INITIAL POOL] Received:', { tenantUid, userUid, initialAmount });
    if (isNaN(initialAmount) || initialAmount < 0) {
      console.log('[CREATE INITIAL POOL] Invalid initialAmount:', initialAmount);
      return res.render('pools/index', {
        title: 'Equity Pool',
        error: 'Invalid initial pool amount',
        pool: null,
        events: [],
        decimalPlaces: 0
      });
    }
    // Check if pool already exists
    const pool = poolModel.getPool(tenantUid);
    console.log('[CREATE INITIAL POOL] Existing pool:', pool);
    if (pool) {
      return res.redirect('/pools');
    }
    // Create the pool and initial event in a transaction
    db.transaction((client) => {
      // Create equity_pool
      const poolResult = client.run(
        'INSERT INTO equity_pool (tenant_uid, initial_amount, total_pool, created_by) VALUES (?, ?, ?, ?)',
        [tenantUid, initialAmount, initialAmount, userUid]
      );
      const poolUid = poolResult.lastInsertRowid;
      console.log('[CREATE INITIAL POOL] Created equity_pool:', poolUid);
      // Create initial pool_event
      client.run(
        "INSERT INTO pool_event (pool_uid, tenant_uid, amount, event_type, effective_date, created_by) VALUES (?, ?, ?, ?, date('now'), ?)",
        [poolUid, tenantUid, initialAmount, 'initial', userUid]
      );
      console.log('[CREATE INITIAL POOL] Created initial pool_event for pool:', poolUid);
    })();
    res.redirect('/pools');
  } catch (err) {
    console.error('[CREATE INITIAL POOL] Error:', err);
    res.render('pools/index', {
      title: 'Equity Pool',
      error: 'An error occurred while creating the initial pool: ' + err.message,
      pool: null,
      events: [],
      decimalPlaces: 0
    });
  }
});

module.exports = router; 