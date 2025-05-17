const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middlewares/auth');
const grantModel = require('../models/grant');
const employeeModel = require('../models/employee');
const ppsModel = require('../models/pps');
const decimal = require('../utils/decimal');
const dateUtils = require('../utils/date');
const validation = require('../utils/validation');
const { handleError } = require('../utils/response');
const db = require('../db');
const { getDisplayDecimalPlaces } = require('../models/tenant');

// Validation schemas
const grantSchema = {
  employeeUid: {
    type: 'integer',
    required: true,
    label: 'Employee'
  },
  grantDate: {
    type: 'date',
    required: true,
    label: 'Grant Date'
  },
  shareAmount: {
    type: 'number',
    required: true,
    positive: true,
    decimalPlaces: true,
    label: 'Share Amount'
  }
};

const terminationSchema = {
  terminationDate: {
    type: 'date',
    required: true,
    label: 'Termination Date'
  },
  reason: {
    type: 'string',
    maxLength: 500,
    label: 'Reason'
  },
  treatment: {
    type: 'string',
    maxLength: 500,
    label: 'Treatment'
  }
};

const vestingEventSchema = {
  vestDate: {
    type: 'date',
    required: true,
    label: 'Vesting Date'
  },
  sharesVested: {
    type: 'number',
    required: true,
    positive: true,
    decimalPlaces: true,
    label: 'Shares Vested'
  }
};

// GET /grants - Grant list page
router.get('/', isAuthenticated, (req, res) => {
  try {
    const tenantUid = req.tenantUid;
    const timezone = req.session.user.timezone;
    const decimalPlaces = getDisplayDecimalPlaces(tenantUid);
    
    // Get query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const status = typeof req.query.status !== 'undefined' ? req.query.status : 'active';
    const search = req.query.search ? req.query.search.trim() : '';
    
    // Check if user is admin
    const isAdmin = req.session.user.role === 'admin';
    
    // For non-admin users, only show their own grants
    let employeeUid = null;
    if (!isAdmin) {
      const user = db.get(
        'SELECT employee_uid FROM user WHERE user_uid = ? AND tenant_uid = ?',
        [req.session.user.user_uid, tenantUid]
      );
      
      if (user && user.employee_uid) {
        employeeUid = user.employee_uid;
      } else {
        // No linked employee, show empty list
        return res.render('grants/index', {
          title: 'Grants',
          grants: [],
          pagination: {
            current: 1,
            total: 0,
            hasNext: false,
            hasPrev: false
          },
          filters: {
            status: 'active',
            search: ''
          },
          totalCount: 0,
          isAdmin: false,
          ppsAvailable: false,
          decimalPlaces,
          currency: req.session.user.currency
        });
      }
    }
    
    // Get grants (with employee filter for regular users)
    const grants = grantModel.getGrants(tenantUid, {
      limit,
      offset,
      status,
      employeeUid,
      search
    });
    
    // Debug log for grant data
    console.log(`Found ${grants.length} grants to display`);
    if (grants.length > 0) {
      // Log the first grant to debug the values
      console.log(`Sample grant data: ID: ${grants[0].uid}, Share Amount: ${grants[0].shareAmount}, Vested Amount: ${grants[0].vestedAmount}`);
    }
    
    // Count total for pagination
    const totalCount = grantModel.countGrants(tenantUid, {
      status,
      employeeUid,
      search
    });
    
    // Get current PPS for monetary values
    const currentPPS = ppsModel.getCurrentPPS(tenantUid);
    
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
    
    // Format grant data for view
    const formattedGrants = grants.map(grant => {
      // Calculate monetary values if PPS is available
      let ppsValue = currentPPS ? currentPPS.pricePerShare : null;
      let vestedAmount = parseFloat(grant.vestedAmount || 0);
      let shareAmount = parseFloat(grant.shareAmount || 0);
      let vestedValue = ppsValue ? decimal.multiply(vestedAmount.toString(), ppsValue) : null;
      let unvestedValue = ppsValue ? decimal.multiply(decimal.subtract(shareAmount.toString(), vestedAmount.toString()), ppsValue) : null;
      let totalValue = ppsValue ? decimal.multiply(grant.shareAmount, ppsValue) : null;
      
      // Ensure we have proper numeric values for percentage calculation
      let vestedPercent = "0%";
      if (shareAmount > 0) {
        const percentValue = (vestedAmount / shareAmount * 100).toFixed(1);
        vestedPercent = `${percentValue}%`;
      }
      
      // Debug log for vested percentage calculation
      console.log(`Grant ${grant.uid}: Share Amount: ${shareAmount}, Vested Amount: ${vestedAmount}, Calculated Percentage: ${vestedPercent}`);
      
      return {
        uid: grant.uid,
        employeeUid: grant.employeeUid,
        employeeName: `${grant.employee.firstName} ${grant.employee.lastName}`,
        employeeEmail: grant.employee.email,
        grantDate: dateUtils.formatDate(grant.grantDate, timezone),
        shareAmount: shareAmount,
        vestedAmount: vestedAmount,
        unvestedAmount: shareAmount - vestedAmount,
        vestedPercent,
        status: grant.status,
        statusBadge: grant.status === 'active' ? 'success' : 'danger',
        inactiveEffectiveDate: grant.inactiveEffectiveDate ? dateUtils.formatDate(grant.inactiveEffectiveDate, timezone) : null,
        inactiveReason: grant.inactiveReason,
        unvestedSharesReturned: grant.unvestedSharesReturned ? decimal.format(grant.unvestedSharesReturned) : '0.000',
        vestedSharesReturned: grant.vestedSharesReturned ? decimal.format(grant.vestedSharesReturned) : '0.000',
        // Monetary values
        vestedValue: vestedValue ? decimal.formatMoney(vestedValue) : null,
        unvestedValue: unvestedValue ? decimal.formatMoney(unvestedValue) : null,
        totalValue: totalValue ? decimal.formatMoney(totalValue) : null,
        version: grant.version
      };
    });
    
    // Render the grants index page
    res.render('grants/index', {
      title: 'Grants',
      grants: formattedGrants,
      pagination,
      filters: {
        status,
        search
      },
      totalCount,
      isAdmin,
      ppsAvailable: !!currentPPS,
      decimalPlaces,
      currency: req.session.user.currency
    });
  } catch (err) {
    console.error('Error fetching grants:', err);
    res.status(500).render('error', { 
      message: 'Error fetching grants',
      error: { status: 500 }
    });
  }
});

// GET /grants/new - New grant form (admin only)
router.get('/new', isAuthenticated, isAdmin, (req, res) => {
  try {
    const tenantUid = req.tenantUid;
    
    // Get active employees for dropdown
    const activeEmployees = employeeModel.getEmployees(tenantUid, {
      status: 'active',
      limit: 100
    });
    
    const formattedEmployees = activeEmployees.map(e => ({
      uid: e.uid,
      name: `${e.firstName} ${e.lastName} (${e.email})`
    }));
    
    res.render('grants/new', {
      title: 'Create Grant',
      employees: formattedEmployees,
      formValues: {
        grantDate: new Date().toISOString().split('T')[0]
      },
      validationErrors: {}
    });
  } catch (err) {
    console.error('Error loading grant form:', err);
    res.render('grants/new', {
      title: 'Create Grant',
      error: 'An error occurred while loading the form',
      employees: [],
      formValues: {},
      validationErrors: {}
    });
  }
});

// POST /grants - Create grant (admin only)
router.post('/', isAuthenticated, isAdmin, (req, res) => {
  try {
    const tenantUid = req.tenantUid;
    const userUid = req.session.user.user_uid;
    const timezone = req.session.user.timezone;
    
    // Validate input
    const { valid, errors } = validation.validateForm(req.body, grantSchema);
    if (!valid) {
      // Get active employees for dropdown (to re-render the form)
      const activeEmployees = employeeModel.getEmployees(tenantUid, {
        status: 'active',
        limit: 100
      });
      
      const formattedEmployees = activeEmployees.map(e => ({
        uid: e.uid,
        name: `${e.firstName} ${e.lastName} (${e.email})`
      }));
      
      return res.render('grants/new', {
        title: 'Create Grant',
        error: 'Please correct the errors below',
        validationErrors: errors,
        formValues: req.body,
        employees: formattedEmployees
      });
    }
    
    // Create grant
    const grant = grantModel.createGrant(tenantUid, {
      employeeUid: req.body.employeeUid,
      grantDate: req.body.grantDate,
      shareAmount: req.body.shareAmount
    }, userUid);
    
    // Debug log for grant object with detailed properties
    console.log('DEBUG: Grant object returned from createGrant:', JSON.stringify(grant, null, 2));
    console.log('DEBUG: Grant object type:', typeof grant);
    console.log('DEBUG: Grant object properties:', Object.keys(grant || {}));
    console.log('DEBUG: Grant uid value:', grant?.uid || grant?.grant_uid);
    
    // More lenient check for valid grant object
    // We'll accept any object with an uid or grant_uid property containing a value
    if (!grant || typeof grant !== 'object' || (!grant.uid && !grant.grant_uid)) {
      console.error('ERROR: Grant creation failed or returned invalid object:', JSON.stringify(grant, null, 2));
      throw new Error('Grant creation failed or returned invalid object - please check server logs');
    }
    
    // Normalize grant uid to ensure it's treated as a number
    const grantUid = grant.uid || grant.grant_uid;
    if (isNaN(grantUid)) {
      console.error('ERROR: Invalid grant UID format:', grant.uid || grant.grant_uid);
      throw new Error('Invalid grant UID returned from creation process');
    }
    
    // Import vesting service
    const vestingService = require('../services/vesting');
    
    // Wait for DB transaction to complete
    setTimeout(function() {}, 500);
    
    // Confirm grant exists in DB
    const savedGrant = db.get(
      `SELECT grant_uid, grant_date, share_amount FROM grant_record 
       WHERE grant_uid = ? AND tenant_uid = ? AND status = 'active' AND deleted_at IS NULL`,
      [grantUid, tenantUid]
    );
    
    if (!savedGrant) {
      console.error('ERROR: Grant not found in DB after creation:', grantUid);
      throw new Error(`Grant ${grantUid} not found in database after creation`);
    }
    
    // Process vesting (backdated or not)
    let vestingMessage = '';
    let vestingSuccess = false;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (!vestingSuccess && retryCount < maxRetries) {
      try {
        console.log(`Vesting calculation attempt ${retryCount + 1} for grant ${grantUid}`);
        const events = vestingService.processBackdatedVesting(
          grantUid,
          tenantUid,
          req.body.grantDate,
          timezone,
          userUid
        );
        if (events && events.length > 0) {
          console.log(`Created ${events.length} vesting events for grant ${grantUid}`);
          vestingMessage = `&vesting=${events.length}+vesting+events+created`;
          vestingSuccess = true;
        } else {
          // Try standard vesting as fallback
          const currentDate = dateUtils.getCurrentDate(timezone);
          const standardEvents = vestingService.processGrantVesting(
            grantUid,
            tenantUid,
            currentDate,
            timezone,
            userUid
          );
          if (standardEvents && standardEvents.length > 0) {
            console.log(`Created ${standardEvents.length} vesting events using standard approach`);
            vestingMessage = `&vesting=${standardEvents.length}+vesting+events+created`;
            vestingSuccess = true;
          } else {
            console.log(`No vesting events needed for grant ${grantUid} (before cliff or no eligible periods)`);
            vestingSuccess = true;
          }
        }
      } catch (vestingErr) {
        console.error(`Error processing vesting (attempt ${retryCount + 1}) for grant ${grantUid}:`, vestingErr);
        retryCount++;
        if (retryCount >= maxRetries) {
          vestingMessage = '&vestingError=Failed+to+process+vesting+events+after+multiple+attempts';
        } else {
          setTimeout(function() {}, 1000);
        }
      }
    }
    
    // Double-check if vesting events were created
    const vestingCheck = db.query(
      `SELECT COUNT(*) as count FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ?`,
      [grantUid, tenantUid]
    );
    
    const eventCount = vestingCheck[0]?.count || 0;
    console.log(`Final check: Grant ${grantUid} has ${eventCount} vesting events`);
    
    // Redirect to grant detail page with success message
    res.redirect(`/grants/${grantUid}?success=Grant+created+successfully${vestingMessage}`);
  } catch (err) {
    console.error('Error creating grant:', err);
    
    // Store tenantUid from request
    const tenantUid = req.tenantUid;
    
    // Get active employees for dropdown (to re-render the form)
    const activeEmployees = employeeModel.getEmployees(tenantUid, {
      status: 'active',
      limit: 100
    });
    
    const formattedEmployees = activeEmployees.map(e => ({
      uid: e.uid,
      name: `${e.firstName} ${e.lastName} (${e.email})`
    }));
    
    // Handle pool constraint error
    if (err.message && err.message.includes('Not enough available shares')) {
      return res.render('grants/new', {
        title: 'Create Grant',
        error: err.message,
        validationErrors: { shareAmount: err.message },
        formValues: req.body,
        employees: formattedEmployees
      });
    }
    
    // Handle other errors
    res.render('grants/new', {
      title: 'Create Grant',
      error: err.message || 'An error occurred while creating the grant',
      validationErrors: {},
      formValues: req.body,
      employees: formattedEmployees
    });
  }
});

// GET /grants/:grant_uid - Grant detail page
router.get('/:grant_uid', isAuthenticated, async (req, res) => {
  console.log('Grant detail route hit:', req.params.grant_uid);
  if (!req.tenantUid) {
    console.error('ERROR: req.tenantUid is missing in grant detail route. Session:', req.session && req.session.user);
    return res.status(500).render('error', {
      message: 'Internal Server Error: Tenant ID missing',
      error: { status: 500, stack: 'Tenant ID (req.tenantUid) is missing. Check session and setTenantId middleware.' }
    });
  }
  try {
    const grantUid = req.params.grant_uid;
    const tenantUid = req.tenantUid;
    const timezone = req.session.user.timezone || 'UTC';
    const isUserAdmin = req.session.user.role === 'admin';
    const userUid = req.session.user.user_uid;
    const currency = req.session.user.currency || '';
    const decimalPlaces = getDisplayDecimalPlaces(tenantUid);

    // Fetch grant details
    const grant = grantModel.getGrant(grantUid, tenantUid);
    if (!grant) {
      console.error('Grant not found:', grantUid, 'for tenant:', tenantUid);
      return res.status(404).render('error', {
        message: 'Grant not found',
        error: { status: 404 }
      });
    }
    // Ensure grant.uid is set
    if (!grant.uid && grant.grant_uid) {
      grant.uid = grant.grant_uid;
    }

    // Fetch employee details for the grant
    let employee = grant.employee;
    if (!employee) {
      employee = employeeModel.getEmployee(grant.employeeUid, tenantUid);
    }
    if (!employee) {
      employee = { firstName: '', lastName: '', email: '' };
    }

    // Fetch vesting events for the grant
    let vestingEvents = Array.isArray(grant.vestingEvents) ? grant.vestingEvents : [];
    if (!vestingEvents.length) {
      // Try to fetch from DB if not present
      try {
        vestingEvents = db.query(
          `SELECT vesting_uid as uid, vest_date, shares_vested, pps_snapshot, created_at, source FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ? ORDER BY vest_date ASC`,
          [grantUid, tenantUid]
        );
      } catch (e) {
        vestingEvents = [];
      }
    }

    // Get current PPS for monetary values
    const currentPPS = ppsModel.getCurrentPPS(tenantUid);
    let ppsValue = currentPPS ? currentPPS.pricePerShare : null;
    let vestedValue = ppsValue ? decimal.multiply(grant.vestedAmount, ppsValue) : null;
    let unvestedValue = ppsValue ? decimal.subtract(decimal.multiply(grant.shareAmount, ppsValue), vestedValue || 0) : null;
    let totalValue = ppsValue ? decimal.multiply(grant.shareAmount, ppsValue) : null;

    // Format grant data for view
    const formattedGrant = {
      uid: grant.uid,
      employeeUid: grant.employeeUid,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      employeeEmail: employee.email,
      grantDate: dateUtils.formatDate(grant.grantDate, timezone),
      shareAmount: decimal.format(grant.shareAmount),
      vestedAmount: decimal.format(grant.vestedAmount),
      unvestedAmount: decimal.format(decimal.subtract(grant.shareAmount, grant.vestedAmount)),
      vestedPercent: decimal.formatPercent(decimal.divide(grant.vestedAmount, grant.shareAmount)),
      status: grant.status,
      statusBadge: grant.status === 'active' ? 'success' : 'danger',
      inactiveEffectiveDate: grant.inactiveEffectiveDate ? dateUtils.formatDate(grant.inactiveEffectiveDate, timezone) : null,
      inactiveReason: grant.inactiveReason,
      unvestedSharesReturned: grant.unvestedSharesReturned ? decimal.format(grant.unvestedSharesReturned) : '0.000',
      vestedSharesReturned: grant.vestedSharesReturned ? decimal.format(grant.vestedSharesReturned) : '0.000',
      vestedValue: vestedValue ? decimal.formatMoney(vestedValue) : null,
      unvestedValue: unvestedValue ? decimal.formatMoney(unvestedValue) : null,
      totalValue: totalValue ? decimal.formatMoney(totalValue) : null,
      version: grant.version,
      createdAt: dateUtils.formatDate(grant.createdAt, timezone)
    };

    // Determine cutoff date (earliest of inactiveEffectiveDate or terminationEffectiveDate)
    let cutoffDate = null;
    if (grant.inactiveEffectiveDate && grant.terminationEffectiveDate) {
      cutoffDate = grant.inactiveEffectiveDate < grant.terminationEffectiveDate ? grant.inactiveEffectiveDate : grant.terminationEffectiveDate;
    } else if (grant.inactiveEffectiveDate) {
      cutoffDate = grant.inactiveEffectiveDate;
    } else if (grant.terminationEffectiveDate) {
      cutoffDate = grant.terminationEffectiveDate;
    }
    // Filter vesting events by cutoff date
    let filteredVestingEvents = vestingEvents;
    if (cutoffDate) {
      filteredVestingEvents = vestingEvents.filter(event =>
        event.source === 'manual' || event.vestDate <= cutoffDate
      );
    }
    // Format vesting events for view
    const formattedVestingEvents = filteredVestingEvents.map(event => ({
      uid: event.uid,
      vestDate: dateUtils.formatDate(event.vestDate, timezone),
      sharesVested: decimal.format(event.sharesVested),
      ppsSnapshot: event.ppsSnapshot ? decimal.format(event.ppsSnapshot) : null,
      value: event.ppsSnapshot ? decimal.formatMoney(decimal.multiply(event.sharesVested, event.ppsSnapshot)) : null,
      createdAt: dateUtils.formatDate(event.createdAt, timezone),
      source: event.source
    }));

    // Debug logging for grant detail
    console.log('DEBUG: formattedGrant object:', JSON.stringify(formattedGrant, null, 2));
    console.log('DEBUG: vestingEvents array:', JSON.stringify(formattedVestingEvents, null, 2));

    res.render('grants/detail', {
      title: `Grant Details (${formattedGrant.employeeName})`,
      grant: formattedGrant,
      vestingEvents: formattedVestingEvents,
      currency,
      isAdmin: isUserAdmin,
      ppsAvailable: !!currentPPS,
      decimalPlaces,
      isInactiveOrTerminated: !!cutoffDate,
      formValues: {
        version: grant.version,
        termination_effective_date: new Date().toISOString().split('T')[0],
        treatment_for_vested: ''
      },
      validationErrors: {}
    });
  } catch (err) {
    console.error('Error fetching grant details:', err, err && err.stack);
    res.status(500).render('error', {
      message: 'Error loading grant details',
      error: err
    });
  }
});

// GET /grants/:grant_uid/terminate - Termination form (admin only)
router.get('/:grant_uid/terminate', isAuthenticated, isAdmin, (req, res) => {
  try {
    const grantUid = req.params.grant_uid;
    const tenantUid = req.tenantUid;
    
    // Get grant details
    const grant = grantModel.getGrant(grantUid, tenantUid);
    
    if (!grant) {
      return res.status(404).render('error', { 
        message: 'Grant not found',
        error: { status: 404 }
      });
    }
    
    if (grant.status !== 'active') {
      return res.redirect(`/grants/${grantUid}?error=Grant+is+already+terminated`);
    }
    
    // Format for form
    const formattedGrant = {
      uid: grant.uid,
      employeeUid: grant.employeeUid,
      employeeName: `${grant.employee.firstName} ${grant.employee.lastName}`,
      shareAmount: decimal.format(grant.shareAmount),
      vestedAmount: decimal.format(grant.vestedAmount),
      unvestedAmount: decimal.format(
        decimal.subtract(grant.shareAmount, grant.vestedAmount)
      ),
      version: grant.version
    };
    
    res.render('grants/terminate', {
      title: `Terminate Grant (${formattedGrant.employeeName})`,
      grant: formattedGrant,
      formValues: {
        terminationDate: new Date().toISOString().split('T')[0],
        version: grant.version
      },
      validationErrors: {}
    });
  } catch (err) {
    console.error('Error loading termination form:', err);
    res.status(500).render('error', { 
      message: 'Error loading termination form',
      error: { status: 500 }
    });
  }
});

// POST /grants/:grant_uid/terminate - Terminate grant (admin only)
router.post('/:grant_uid/terminate', isAuthenticated, isAdmin, (req, res) => {
  try {
    const grantUid = req.params.grant_uid;
    const tenantUid = req.tenantUid;
    const userUid = req.session.user.user_uid;
    
    // Get current grant data
    const grant = grantModel.getGrant(grantUid, tenantUid);
    
    if (!grant) {
      return res.status(404).render('error', { 
        message: 'Grant not found',
        error: { status: 404 }
      });
    }
    
    if (grant.status !== 'active') {
      return res.redirect(`/grants/${grantUid}?error=Grant+is+already+terminated`);
    }
    
    // Validate input
    const { valid, errors } = validation.validateForm(req.body, terminationSchema);
    if (!valid) {
      const formattedGrant = {
        uid: grant.uid,
        employeeUid: grant.employeeUid,
        employeeName: `${grant.employee.firstName} ${grant.employee.lastName}`,
        shareAmount: decimal.format(grant.shareAmount),
        vestedAmount: decimal.format(grant.vestedAmount),
        unvestedAmount: decimal.format(
          decimal.subtract(grant.shareAmount, grant.vestedAmount)
        ),
        version: grant.version
      };
      
      return res.render('grants/terminate', {
        title: `Terminate Grant (${formattedGrant.employeeName})`,
        grant: formattedGrant,
        error: 'Please correct the errors below',
        validationErrors: errors,
        formValues: { ...req.body }
      });
    }
    
    // Check optimistic locking version
    if (parseInt(req.body.version) !== grant.version) {
      return res.redirect(`/grants/${grantUid}?error=Grant+has+been+modified.+Please+refresh+and+try+again.`);
    }
    
    // Terminate grant
    const updatedGrant = grantModel.terminateGrant(grantUid, tenantUid, {
      terminationDate: req.body.terminationDate,
      reason: req.body.reason,
      treatment: req.body.treatment,
      version: parseInt(req.body.version)
    }, userUid);
    
    // Redirect to grant detail page with success message
    res.redirect(`/grants/${grantUid}?success=Grant+terminated+successfully`);
  } catch (err) {
    console.error('Error terminating grant:', err);
    
    // Handle optimistic locking error
    if (err.message && err.message.includes('modified by another user')) {
      return res.redirect(`/grants/${req.params.grant_uid}?error=${encodeURIComponent(err.message)}`);
    }
    
    // Handle other errors
    res.redirect(`/grants/${req.params.grant_uid}?error=${encodeURIComponent(err.message || 'An error occurred while terminating the grant')}`);
  }
});

// GET /grants/:grant_uid/add-vesting - Add vesting event form (admin only)
router.get('/:grant_uid/add-vesting', isAuthenticated, isAdmin, (req, res) => {
  try {
    const grantUid = req.params.grant_uid;
    const tenantUid = req.tenantUid;
    
    // Get grant details
    const grant = grantModel.getGrant(grantUid, tenantUid);
    
    if (!grant) {
      return res.status(404).render('error', { 
        message: 'Grant not found',
        error: { status: 404 }
      });
    }
    
    if (grant.status !== 'active') {
      return res.redirect(`/grants/${grantUid}?error=Cannot+add+vesting+to+an+inactive+grant`);
    }
    
    // Get current PPS
    const currentPPS = ppsModel.getCurrentPPS(tenantUid);
    
    // Format for form
    const formattedGrant = {
      uid: grant.uid,
      employeeUid: grant.employeeUid,
      employeeName: `${grant.employee.firstName} ${grant.employee.lastName}`,
      shareAmount: decimal.format(grant.shareAmount),
      vestedAmount: decimal.format(grant.vestedAmount),
      unvestedAmount: decimal.format(
        decimal.subtract(grant.shareAmount, grant.vestedAmount)
      ),
      version: grant.version
    };
    
    res.render('grants/add-vesting', {
      title: `Add Vesting Event (${formattedGrant.employeeName})`,
      grant: formattedGrant,
      formValues: {
        vestDate: new Date().toISOString().split('T')[0],
        version: grant.version,
        ppsSnapshot: currentPPS ? currentPPS.pricePerShare : null
      },
      validationErrors: {},
      currency: req.session.user.currency
    });
  } catch (err) {
    console.error('Error loading vesting form:', err);
    res.status(500).render('error', { 
      message: 'Error loading vesting form',
      error: { status: 500 }
    });
  }
});

// POST /grants/:grant_uid/add-vesting - Add vesting event (admin only)
router.post('/:grant_uid/add-vesting', isAuthenticated, isAdmin, (req, res) => {
  try {
    const grantUid = req.params.grant_uid;
    const tenantUid = req.tenantUid;
    const userUid = req.session.user.user_uid;
    
    // Get current grant data
    const grant = grantModel.getGrant(grantUid, tenantUid);
    
    if (!grant) {
      return res.status(404).render('error', { 
        message: 'Grant not found',
        error: { status: 404 }
      });
    }
    
    if (grant.status !== 'active') {
      return res.redirect(`/grants/${grantUid}?error=Cannot+add+vesting+to+an+inactive+grant`);
    }
    
    // Validate input
    const { valid, errors } = validation.validateForm(req.body, vestingEventSchema);
    if (!valid) {
      const formattedGrant = {
        uid: grant.uid,
        employeeUid: grant.employeeUid,
        employeeName: `${grant.employee.firstName} ${grant.employee.lastName}`,
        shareAmount: decimal.format(grant.shareAmount),
        vestedAmount: decimal.format(grant.vestedAmount),
        unvestedAmount: decimal.format(
          decimal.subtract(grant.shareAmount, grant.vestedAmount)
        ),
        version: grant.version
      };
      
      return res.render('grants/add-vesting', {
        title: `Add Vesting Event (${formattedGrant.employeeName})`,
        grant: formattedGrant,
        error: 'Please correct the errors below',
        validationErrors: errors,
        formValues: req.body,
        currency: req.session.user.currency
      });
    }
    
    // Check optimistic locking version
    if (parseInt(req.body.version) !== grant.version) {
      return res.redirect(`/grants/${grantUid}?error=Grant+has+been+modified.+Please+refresh+and+try+again.`);
    }
    
    // Add vesting event
    const updatedGrant = grantModel.addVestingEvent(grantUid, tenantUid, {
      vestDate: req.body.vestDate,
      sharesVested: req.body.sharesVested,
      ppsSnapshot: req.body.ppsSnapshot,
      version: parseInt(req.body.version)
    }, userUid);
    
    // Redirect to grant detail page with success message
    res.redirect(`/grants/${grantUid}?success=Vesting+event+added+successfully`);
  } catch (err) {
    console.error('Error adding vesting event:', err);
    
    // Handle specific error cases
    if (err.message && err.message.includes('exceed total shares')) {
      return res.redirect(`/grants/${req.params.grant_uid}?error=${encodeURIComponent(err.message)}`);
    }
    
    // Handle optimistic locking error
    if (err.message && err.message.includes('modified by another user')) {
      return res.redirect(`/grants/${req.params.grant_uid}?error=${encodeURIComponent(err.message)}`);
    }
    
    // Handle other errors
    res.redirect(`/grants/${req.params.grant_uid}?error=${encodeURIComponent(err.message || 'An error occurred while adding vesting event')}`);
  }
});

// POST /grants/:grant_uid/delete - Delete grant (admin only)
router.post('/:grant_uid/delete', isAuthenticated, isAdmin, (req, res) => {
  try {
    const grantUid = req.params.grant_uid;
    const tenantUid = req.tenantUid;
    const userUid = req.session.user.user_uid;
    const version = parseInt(req.body.version);
    
    // Delete grant
    grantModel.deleteGrant(grantUid, tenantUid, version, userUid);
    
    // Redirect to grants list with success message
    res.redirect('/grants?success=Grant+deleted+successfully');
  } catch (err) {
    console.error('Error deleting grant:', err);
    
    // Handle specific error cases
    if (err.message && err.message.includes('vesting events')) {
      return res.redirect(`/grants/${req.params.grant_uid}?error=${encodeURIComponent('Cannot delete a grant with vesting events')}`);
    }
    
    // Handle optimistic locking error
    if (err.message && err.message.includes('modified by another user')) {
      return res.redirect(`/grants/${req.params.grant_uid}?error=${encodeURIComponent(err.message)}`);
    }
    
    // Handle other errors
    res.redirect(`/grants/${req.params.grant_uid}?error=${encodeURIComponent(err.message || 'An error occurred while deleting the grant')}`);
  }
});

// POST /grants/:grant_uid/calculate-vesting
router.post('/:grant_uid/calculate-vesting', isAuthenticated, isAdmin, (req, res) => {
  // Delegate to vesting service (same as /vesting/calculate/:grantUid)
  const vestingService = require('../services/vesting');
  const grantUid = req.params.grant_uid;
  const tenantUid = req.tenantUid;
  const userUid = req.session.user.user_uid;
  const timezone = req.session.user.timezone;
  try {
    const currentDate = require('../utils/date').getCurrentDate(timezone);
    const events = vestingService.processGrantVesting(
      grantUid, tenantUid, currentDate, timezone, userUid
    );
    return res.json({
      success: true,
      message: `Created ${events.length} vesting events`,
      data: { eventsCreated: events.length, grantUid }
    });
  } catch (err) {
    return handleError(err, res);
  }
});

// GET /grants/:grant_uid/vesting-events
router.get('/:grant_uid/vesting-events', isAuthenticated, (req, res) => {
  const grantUid = req.params.grant_uid;
  const tenantUid = req.tenantUid;
  try {
    const events = require('../db').query(
      `SELECT vesting_uid, vest_date, shares_vested, pps_snapshot, created_at FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ? ORDER BY vest_date ASC`,
      [grantUid, tenantUid]
    );
    return res.json({ success: true, data: events });
  } catch (err) {
    return handleError(err, res);
  }
});

// PATCH /grants/:grant_uid
router.patch('/:grant_uid', isAuthenticated, isAdmin, (req, res) => {
  const grantUid = req.params.grant_uid;
  const tenantUid = req.tenantUid;
  const userUid = req.session.user.user_uid;
  try {
    const updates = req.body;
    const updatedGrant = require('../models/grant').updateGrant(grantUid, tenantUid, updates, userUid);
    return res.json({ success: true, data: updatedGrant });
  } catch (err) {
    return handleError(err, res);
  }
});

// DELETE /grants/:grant_uid
router.delete('/:grant_uid', isAuthenticated, isAdmin, (req, res) => {
  const grantUid = req.params.grant_uid;
  const tenantUid = req.tenantUid;
  const userUid = req.session.user.user_uid;
  const version = req.body.version;
  try {
    require('../models/grant').deleteGrant(grantUid, tenantUid, version, userUid);
    return res.json({ success: true });
  } catch (err) {
    return handleError(err, res);
  }
});

// Grant-level vested share buyback (admin only)
router.post('/:grant_uid/buyback', isAuthenticated, isAdmin, (req, res) => {
  try {
    const tenantUid = req.tenantUid;
    const userUid = req.session.user.user_uid;
    const grantUid = req.params.grant_uid;
    const amount = parseFloat(req.body.amount);
    if (!grantUid || isNaN(amount) || amount <= 0) {
      req.flash('error', 'Invalid grant UID or buyback amount must be greater than zero.');
      return res.redirect('/grants/' + (req.params.grant_uid || ''));
    }
    const updatedGrant = grantModel.buybackVestedShares(grantUid, tenantUid, amount, userUid);
    req.flash('success', `Successfully bought back ${amount} shares for grant ${grantUid}.`);
    return res.redirect('/grants/' + grantUid);
  } catch (err) {
    console.error('Error in grant-level buyback:', err);
    req.flash('error', err.message || 'An error occurred during buyback.');
    return res.redirect('/grants/' + (req.params.grant_uid || ''));
  }
});

// Grant import page (admin only)
router.get('/import', isAuthenticated, isAdmin, (req, res) => {
  res.render('grants/import', {
    title: 'Import Grants'
  });
});

// GET /grants/:grant_uid/minidetail - Minimal grant detail for debugging
router.get('/:grant_uid/minidetail', isAuthenticated, async (req, res) => {
  const grantUid = req.params.grant_uid;
  const tenantUid = req.tenantUid;
  try {
    const grant = grantModel.getGrant(grantUid, tenantUid);
    if (!grant) {
      return res.status(404).json({
        success: false,
        error: 'Grant not found',
        grantUid,
        tenantUid
      });
    }
    // Basic stats
    const stats = {
      grantUid: grant.uid,
      employeeUid: grant.employeeUid,
      status: grant.status,
      shareAmount: grant.shareAmount,
      vestedAmount: grant.vestedAmount,
      unvestedAmount: grant.shareAmount && grant.vestedAmount ? (grant.shareAmount - grant.vestedAmount) : null,
      createdAt: grant.createdAt,
      version: grant.version
    };
    // Log the full grant object for debugging
    console.log('[MINIDETAIL] Grant object:', JSON.stringify(grant, null, 2));
    return res.json({
      success: true,
      stats,
      debug: grant
    });
  } catch (err) {
    console.error('[MINIDETAIL] Error fetching grant:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Error fetching grant',
      stack: err.stack
    });
  }
});

// GET /grants/:grant_uid/termination-summary - For AJAX dynamic summary in termination form
router.get('/:grant_uid/termination-summary', isAuthenticated, isAdmin, (req, res) => {
  const grantUid = req.params.grant_uid;
  const tenantUid = req.tenantUid;
  const date = req.query.date;
  const treatment = req.query.treatment;
  const timezone = req.session.user?.timezone || 'UTC';
  if (!date) {
    return res.status(400).json({ success: false, message: 'Missing date parameter' });
  }
  try {
    const grant = grantModel.getGrant(grantUid, tenantUid);
    if (!grant) {
      return res.status(404).json({ success: false, message: 'Grant not found' });
    }
    // Calculate vesting as of the selected date
    const vestingService = require('../services/vesting');
    const db = require('../db');
    const summary = vestingService.calculateVestingForDisplay({
      uid: grant.uid,
      grantDate: grant.grantDate,
      shareAmount: grant.shareAmount,
      inactiveEffectiveDate: grant.inactiveEffectiveDate,
      terminationEffectiveDate: grant.terminationEffectiveDate
    }, date, timezone);
    const vested = summary.theoreticalVestedAmount;
    const unvested = Math.max(0, parseFloat(grant.shareAmount) - vested);
    // Sum all manual vesting for this grant (regardless of date)
    const manualVestingRow = db.get(
      "SELECT SUM(shares_vested) as manualVested FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ? AND (source LIKE '%manual%' OR source = 'manual')",
      [grant.uid, tenantUid]
    );
    const manualVested = manualVestingRow && manualVestingRow.manualVested ? parseFloat(manualVestingRow.manualVested) : 0;
    const totalVestedIncludingManual = vested + manualVested;
    // Optionally, if treatment is buyback, all vested shares are returned; if retain, none are returned; if cancel, all are returned
    let vestedReturned = 0;
    let explanation = 'Vested shares as of the termination date are calculated based on the original vesting schedule, plus any manual vesting events (regardless of date).';
    if (treatment === 'buyback' || treatment === 'cancel') {
      vestedReturned = totalVestedIncludingManual;
      if (treatment === 'cancel') {
        explanation += ' All vested shares will be returned to the pool (cancel).';
      }
    } else if (treatment === 'retain') {
      vestedReturned = 0;
      explanation += ' All vested shares will remain with the employee.';
    } else {
      explanation += ' Select a treatment to see how vested shares will be handled.';
    }
    res.json({
      success: true,
      vested: vested,
      unvested: unvested,
      manualVested: manualVested,
      totalVestedIncludingManual: totalVestedIncludingManual,
      vestedReturned: vestedReturned,
      treatment: treatment || null,
      explanation
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router; 