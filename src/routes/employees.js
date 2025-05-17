const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin, isEmployeeOrAdmin } = require('../middlewares/auth');
const employeeModel = require('../models/employee');
const grantModel = require('../models/grant');
const validation = require('../utils/validation');
const dateUtils = require('../utils/date');
const { handleError } = require('../utils/response');
const { getDisplayDecimalPlaces } = require('../models/tenant');
const ppsModel = require('../models/pps');
const decimal = require('../utils/decimal');

console.log('EMPLOYEES ROUTES LOADED');

// Validation schema for employee
const employeeSchema = {
  email: {
    type: 'email',
    required: true,
    label: 'Email Address'
  },
  firstName: {
    type: 'string',
    required: true,
    maxLength: 50,
    label: 'First Name'
  },
  lastName: {
    type: 'string',
    required: true,
    maxLength: 50,
    label: 'Last Name'
  },
  status: {
    type: 'enum',
    values: ['active', 'inactive'],
    label: 'Status'
  }
};

// GET /employees - Employee list page
router.get('/', isAuthenticated, isAdmin, (req, res) => {
  console.log('ROUTE /employees HIT');
  try {
    const tenantUid = req.tenantUid;
    const timezone = req.session.user.timezone;
    
    // Get pagination parameters
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    
    // Get search and filter parameters
    const search = req.query.search || null;
    const status = typeof req.query.status !== 'undefined' ? req.query.status : 'active';
    const sort = req.query.sort || 'first_name_asc';
    
    // Get employees with summary info (active grants count)
    let employees = employeeModel.getEmployeesWithGrantSummary(tenantUid, {
      limit,
      offset,
      status,
      search,
      sort
    });
    if (!Array.isArray(employees)) employees = employees ? [employees] : [];
    console.log('Fetched employees:', employees); // Debug log
    
    // Count total for pagination
    const totalCount = employeeModel.countEmployees(tenantUid, {
      status,
      search
    });
    
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
    
    // Format employee data for view
    const formattedEmployees = employees.map(employee => ({
      uid: employee.uid,
      email: employee.email,
      firstName: employee.firstName,
      lastName: employee.lastName,
      fullName: `${employee.firstName} ${employee.lastName}`,
      status: employee.status,
      grantCount: employee.grantCount || 0,
      totalActiveShares: employee.totalActiveShares || 0,
      totalVestedShares: employee.totalVestedShares || 0,
      createdAt: dateUtils.formatDate(employee.createdAt, timezone)
    }));
    
    // Render the employee list page
    res.render('employees/index', {
      title: 'Employees',
      employees: formattedEmployees,
      pagination,
      filters: {
        search: search || '',
        status: status || 'active',
        sort
      },
      totalCount
    });
  } catch (err) {
    console.error('Error fetching employees:', err);
    res.render('employees/index', {
      title: 'Employees',
      error: 'An error occurred while loading employee data',
      employees: [],
      pagination: { current: 1, total: 1 },
      filters: { search: '', status: 'active' },
      totalCount: 0
    });
  }
});

// GET /employees/new - New employee form
router.get('/new', isAuthenticated, isAdmin, (req, res) => {
  res.render('employees/new', {
    title: 'Add Employee',
    formValues: {},
    validationErrors: {}
  });
});

// POST /employees - Create employee
router.post('/', isAuthenticated, isAdmin, (req, res) => {
  console.log('ROUTE /employees POST HIT');
  try {
    const tenantUid = req.tenantUid;
    const userUid = req.session.user.user_uid;
    
    // Validate input
    const { valid, errors } = validation.validateForm(req.body, employeeSchema);
    if (!valid) {
      return res.render('employees/new', {
        title: 'Add Employee',
        error: 'Please correct the errors below',
        validationErrors: errors,
        formValues: req.body
      });
    }
    
    // Create employee
    const auditLog = {
      tenantUid,
      userUid,
      action: 'EMPLOYEE_CREATE',
      entityType: 'employee',
      entityUid: null, // will be set after creation
      details: {
        after: {
          email: req.body.email,
          first_name: req.body.firstName,
          last_name: req.body.lastName,
          status: req.body.status || 'active'
        }
      }
    };
    const employee = employeeModel.createEmployee(
      tenantUid,
      {
        email: req.body.email,
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        status: req.body.status || 'active'
      },
      userUid,
      auditLog
    );
    
    // Redirect to employee list with success message
    res.redirect('/employees?success=Employee+added+successfully');
  } catch (err) {
    console.error('Error creating employee:', err);
    
    // Handle unique constraint violation
    if (err.message && err.message.includes('already exists')) {
      return res.render('employees/new', {
        title: 'Add Employee',
        error: err.message,
        validationErrors: { email: err.message },
        formValues: req.body
      });
    }
    
    // Handle other errors
    res.render('employees/new', {
      title: 'Add Employee',
      error: 'An error occurred while creating the employee',
      validationErrors: {},
      formValues: req.body
    });
  }
});

// GET /employees/:employee_uid/terminate - Terminate employee form (admin only)
router.get('/:employee_uid/terminate', isAuthenticated, isAdmin, (req, res) => {
  console.log('TERMINATE ROUTE HIT', req.params.employee_uid);
  try {
    const employeeUid = req.params.employee_uid;
    const tenantUid = req.tenantUid;
    const employee = employeeModel.getEmployee(employeeUid, tenantUid);
    if (!employee) {
      console.error('Employee not found for uid:', employeeUid, 'tenant:', tenantUid);
      return res.status(404).render('error', {
        message: 'Employee not found',
        error: { status: 404 }
      });
    }
    const isAjax = req.xhr || req.headers.accept.indexOf('json') > -1 || req.headers['x-requested-with'] === 'XMLHttpRequest';
    res.render('employees/terminate', {
      title: `Terminate Employee: ${employee.firstName} ${employee.lastName}`,
      employee,
      formValues: {
        termination_effective_date: new Date().toISOString().split('T')[0],
        treatment_for_vested: '',
        reason: ''
      },
      validationErrors: {},
      csrfToken: req.csrfToken(),
      layout: isAjax ? false : undefined
    });
  } catch (err) {
    console.error('Error in /employees/:employee_uid/terminate route:', err);
    res.status(500).render('error', {
      message: 'Error loading employee termination form',
      error: { status: 500 }
    });
  }
});

// GET /employees/:employee_uid - Employee detail page
router.get('/:employee_uid', isAuthenticated, isEmployeeOrAdmin, (req, res) => {
  console.log('Employee detail route hit:', req.params.employee_uid);
  if (!req.tenantUid) {
    console.error('ERROR: req.tenantUid is missing in employee detail route. Session:', req.session && req.session.user);
    return res.status(500).render('error', {
      message: 'Internal Server Error: Tenant ID missing',
      error: { status: 500, stack: 'Tenant ID (req.tenantUid) is missing. Check session and setTenantId middleware.' }
    });
  }
  try {
    const employeeUid = req.params.employee_uid;
    const tenantUid = req.tenantUid;
    const timezone = req.session.user.timezone;
    
    // Get employee details
    const employee = employeeModel.getEmployee(employeeUid, tenantUid);
    
    if (!employee) {
      return res.status(404).render('error', { 
        message: 'Employee not found',
        error: { status: 404 }
      });
    }
    
    // Get pagination parameters for grants
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    
    // Get grants for this employee
    const grants = grantModel.getGrants(tenantUid, {
      employeeUid,
      limit,
      offset
    });
    
    // Count total grants for pagination
    const totalGrantCount = grantModel.countGrants(tenantUid, { employeeUid });
    
    // Get grant summary
    const grantSummary = grantModel.getEmployeeGrantsSummary(employeeUid, tenantUid);

    // Get current PPS
    const currentPPS = ppsModel.getCurrentPPS(tenantUid);
    let ppsValue = currentPPS ? currentPPS.pricePerShare : null;
    let vestedValue = null;
    let unvestedValue = null;
    let totalValue = null;
    if (ppsValue) {
      vestedValue = decimal.multiply(grantSummary.totalVestedShares, ppsValue);
      unvestedValue = decimal.multiply(grantSummary.totalUnvestedShares, ppsValue);
      totalValue = decimal.multiply(decimal.add(grantSummary.totalVestedShares, grantSummary.totalUnvestedShares), ppsValue);
    }
    
    // Calculate grant pagination
    const totalPages = Math.ceil(totalGrantCount / limit);
    const pagination = {
      current: page,
      total: totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      next: page + 1,
      prev: page - 1
    };
    
    // Format employee data
    const formattedEmployee = {
      uid: employee.uid,
      email: employee.email,
      firstName: employee.firstName,
      lastName: employee.lastName,
      fullName: `${employee.firstName} ${employee.lastName}`,
      status: employee.status,
      createdAt: dateUtils.formatDate(employee.createdAt, timezone)
    };
    
    // Format grants data
    const formattedGrants = grants.map(grant => ({
      uid: grant.uid,
      grantDate: dateUtils.formatDate(grant.grantDate, timezone),
      shareAmount: grant.shareAmount,
      vestedAmount: grant.vestedAmount,
      unvestedAmount: grant.unvestedAmount,
      status: grant.status,
      inactiveEffectiveDate: grant.inactiveEffectiveDate ? dateUtils.formatDate(grant.inactiveEffectiveDate, timezone) : null,
      inactiveReason: grant.inactiveReason,
      version: grant.version
    }));
    
    const decimalPlaces = getDisplayDecimalPlaces(tenantUid);
    // Get currency (default to USD if not set)
    let currency = 'USD';
    if (typeof req.session.user.currency === 'string' && req.session.user.currency.length > 0) {
      currency = req.session.user.currency;
    } else if (typeof req.session.currency === 'string' && req.session.currency.length > 0) {
      currency = req.session.currency;
    }
    // Render the employee detail page
    res.render('employees/detail', {
      title: `Employee: ${formattedEmployee.fullName}`,
      employee: formattedEmployee,
      grants: formattedGrants,
      grantSummary,
      ppsAvailable: !!currentPPS,
      ppsValue,
      vestedValue,
      unvestedValue,
      totalValue,
      pagination,
      totalGrantCount,
      isAdmin: req.session.user.role === 'admin',
      decimalPlaces,
      currency
    });
  } catch (err) {
    console.error('Error fetching employee details:', err);
    res.status(500).render('error', { 
      message: 'Error loading employee details',
      error: { status: 500 }
    });
  }
});

// GET /employees/:employee_uid/edit - Edit employee form
router.get('/:employee_uid/edit', isAuthenticated, isAdmin, (req, res) => {
  try {
    const employeeUid = req.params.employee_uid;
    const tenantUid = req.tenantUid;
    
    // Get employee details
    const employee = employeeModel.getEmployee(employeeUid, tenantUid);
    
    if (!employee) {
      return res.status(404).render('error', { 
        message: 'Employee not found',
        error: { status: 404 }
      });
    }
    
    // Populate form values
    const formValues = {
      email: employee.email,
      firstName: employee.firstName,
      lastName: employee.lastName,
      status: employee.status
    };
    
    // Render the edit form
    res.render('employees/edit', {
      title: `Edit Employee: ${employee.firstName} ${employee.lastName}`,
      employee,
      formValues,
      validationErrors: {}
    });
  } catch (err) {
    console.error('Error loading employee edit form:', err);
    res.status(500).render('error', { 
      message: 'Error loading employee data',
      error: { status: 500 }
    });
  }
});

// POST /employees/:employee_uid - Update employee
router.post('/:employee_uid', isAuthenticated, isAdmin, (req, res) => {
  try {
    const employeeUid = req.params.employee_uid;
    const tenantUid = req.tenantUid;
    const userUid = req.session.user.user_uid;
    
    // Get current employee data
    const employee = employeeModel.getEmployee(employeeUid, tenantUid);
    
    if (!employee) {
      return res.status(404).render('error', { 
        message: 'Employee not found',
        error: { status: 404 }
      });
    }
    // Block direct status change to 'inactive'
    if (req.body.status === 'inactive') {
      return res.render('employees/edit', {
        title: `Edit Employee: ${employee.firstName} ${employee.lastName}`,
        employee,
        error: 'To set an employee as inactive, please use the Terminate Employee workflow. Termination requires an effective date, treatment for vested shares, and (optionally) a reason.',
        validationErrors: { status: 'Use the Terminate Employee button to set inactive.' },
        formValues: req.body
      });
    }
    
    // Validate input
    const { valid, errors } = validation.validateForm(req.body, employeeSchema);
    if (!valid) {
      return res.render('employees/edit', {
        title: `Edit Employee: ${employee.firstName} ${employee.lastName}`,
        employee,
        error: 'Please correct the errors below',
        validationErrors: errors,
        formValues: req.body
      });
    }
    
    // Update employee
    const updatedEmployee = employeeModel.updateEmployee(employeeUid, tenantUid, {
      email: req.body.email,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      status: req.body.status
    }, userUid);
    
    // Redirect to employee detail page with success message
    res.redirect(`/employees/${employeeUid}?success=Employee+updated+successfully`);
  } catch (err) {
    console.error('Error updating employee:', err);
    
    // Handle unique constraint violation
    if (err.message && err.message.includes('already exists')) {
      return res.render('employees/edit', {
        title: `Edit Employee`,
        employee: { uid: req.params.employee_uid },
        error: err.message,
        validationErrors: { email: err.message },
        formValues: req.body
      });
    }
    
    // Handle other errors
    res.render('employees/edit', {
      title: 'Edit Employee',
      employee: { uid: req.params.employee_uid },
      error: 'An error occurred while updating the employee',
      validationErrors: {},
      formValues: req.body
    });
  }
});

// POST /employees/:employee_uid/delete - Delete employee
router.post('/:employee_uid/delete', isAuthenticated, isAdmin, (req, res) => {
  try {
    const employeeUid = req.params.employee_uid;
    const tenantUid = req.tenantUid;
    const userUid = req.session.user.user_uid;
    
    // Delete employee
    employeeModel.deleteEmployee(employeeUid, tenantUid, userUid);
    
    // Redirect to employee list with success message
    res.redirect('/employees?success=Employee+deleted+successfully');
  } catch (err) {
    console.error('Error deleting employee:', err);
    
    // Handle specific error cases
    if (err.message && err.message.includes('active grants')) {
      return res.redirect(`/employees/${req.params.employee_uid}?error=${encodeURIComponent('Cannot delete employee with active grants. Terminate all grants first.')}`);
    }
    
    // Handle other errors
    res.redirect(`/employees/${req.params.employee_uid}?error=${encodeURIComponent('An error occurred while deleting the employee')}`);
  }
});

// PATCH /employees/:employee_uid - Update employee (partial update)
router.patch('/:employee_uid', isAuthenticated, isAdmin, (req, res) => {
  const employeeUid = req.params.employee_uid;
  const tenantUid = req.tenantUid;
  const userUid = req.session.user.user_uid;
  try {
    const updates = req.body;
    // Block direct status change to 'inactive'
    if (updates.status === 'inactive') {
      return res.status(400).json({ success: false, error: 'To set an employee as inactive, use the Terminate Employee endpoint. Termination requires an effective date, treatment for vested shares, and (optionally) a reason.' });
    }
    const updatedEmployee = employeeModel.updateEmployee(employeeUid, tenantUid, updates, userUid);
    return res.json({ success: true, data: updatedEmployee });
  } catch (err) {
    return handleError(err, res);
  }
});

// DELETE /employees/:employee_uid - Soft delete employee
router.delete('/:employee_uid', isAuthenticated, isAdmin, (req, res) => {
  const employeeUid = req.params.employee_uid;
  const tenantUid = req.tenantUid;
  const userUid = req.session.user.user_uid;
  try {
    employeeModel.deleteEmployee(employeeUid, tenantUid, userUid);
    return res.json({ success: true });
  } catch (err) {
    return handleError(err, res);
  }
});

// POST /employees/:employee_uid/terminate - Employee-level termination (new flow)
router.post('/:employee_uid/terminate', isAuthenticated, isAdmin, (req, res) => {
  const employeeUid = req.params.employee_uid;
  const tenantUid = req.tenantUid || req.session.tenant_uid;
  const userUid = req.session.user?.user_uid || req.session.user_uid;
  const db = require('../db');
  const poolModel = require('../models/pool');
  const grantModel = require('../models/grant');
  const vestingService = require('../services/vesting');
  const timezone = req.session.user?.timezone || 'UTC';
  const { effectiveDate, treatment } = req.body;
  if (!effectiveDate || !treatment) {
    return res.status(400).json({ success: false, message: 'Missing effective date or treatment.' });
  }
  // Enforce that termination effective date cannot be in the future
  const today = new Date().toISOString().split('T')[0];
  if (effectiveDate > today) {
    return res.status(400).json({ success: false, message: 'Termination effective date cannot be in the future.' });
  }
  // Get all active grants for this employee
  const grants = grantModel.getGrants(tenantUid, { employeeUid, status: 'active', limit: 100 });
  if (!grants || grants.length === 0) {
    return res.status(400).json({ success: false, message: 'No active grants to terminate.' });
  }
  try {
    db.transaction((client) => {
      let totalVested = 0;
      let totalUnvested = 0;
      grants.forEach(grant => {
        // Calculate vesting as of the effective date
        const summary = vestingService.calculateVestingForDisplay({
          uid: grant.uid,
          grantDate: grant.grantDate,
          shareAmount: grant.shareAmount,
          inactiveEffectiveDate: grant.inactiveEffectiveDate,
          terminationEffectiveDate: grant.terminationEffectiveDate
        }, effectiveDate, timezone);
        const vested = summary.theoreticalVestedAmount;
        const unvested = Math.max(0, parseFloat(grant.shareAmount) - vested);
        console.log(`[TERMINATE DEBUG] Grant ${grant.uid}: vested=${vested}, unvested=${unvested}, grantDate=${grant.grantDate}, shareAmount=${grant.shareAmount}, effectiveDate=${effectiveDate}`);
        totalVested += vested;
        totalUnvested += unvested;
        // Mark grant as inactive and set inactive_effective_date
        client.run("UPDATE grant_record SET status = 'inactive', inactive_effective_date = ? WHERE grant_uid = ?", [effectiveDate, grant.uid]);
        // If treatment is buyback or cancel, update vested_shares_returned and log pool event
        if (treatment === 'buyback' || treatment === 'cancel') {
          client.run("UPDATE grant_record SET vested_shares_returned = ? WHERE grant_uid = ?", [vested, grant.uid]);
          const vestedEventType = (treatment === 'buyback') ? 'return_boughtback' : 'return_vested';
          poolModel.returnSharesToPool(client, tenantUid, vested, vestedEventType, effectiveDate, userUid, employeeUid, grant.uid);
        }
        // Always return unvested shares
        poolModel.returnSharesToPool(client, tenantUid, unvested, 'return_unvested', effectiveDate, userUid, employeeUid, grant.uid);
      });
      // Mark employee as terminated and set termination_effective_date
      client.run("UPDATE employee SET status = 'terminated', termination_effective_date = ? WHERE employee_uid = ? AND tenant_uid = ?", [effectiveDate, employeeUid, tenantUid]);
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Terminate employee error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Employee-level vested share buyback (admin only)
router.post('/:employee_uid/buyback', isAuthenticated, isAdmin, (req, res) => {
  try {
    const tenantUid = req.tenantUid;
    const userUid = req.session.user.user_uid;
    const employeeUid = req.params.employee_uid;
    const amount = parseFloat(req.body.amount);
    console.log('[BUYBACK DEBUG] Incoming request:', { employeeUid, tenantUid, userUid, amount });
    if (!employeeUid || isNaN(amount)) {
      console.log('[BUYBACK DEBUG] Invalid input:', { employeeUid, amount });
      return res.status(400).json({ success: false, error: 'Invalid employee UID or amount' });
    }
    const breakdown = grantModel.buybackVestedSharesForEmployee(employeeUid, tenantUid, amount, userUid);
    console.log('[BUYBACK DEBUG] Buyback result:', breakdown);
    return res.json({ success: true, employeeUid, boughtBack: amount, breakdown });
  } catch (err) {
    console.error('[BUYBACK DEBUG] Error in employee-level buyback:', err);
    return res.status(400).json({ success: false, error: err.message });
  }
});

// API Routes

// GET /employees/api/list - API endpoint for employee dropdown
router.get('/api/list', isAuthenticated, isAdmin, (req, res) => {
  try {
    const tenantUid = req.tenantUid;
    const employees = employeeModel.getEmployees(tenantUid, {
      status: 'active',
      limit: 100
    });
    const formattedEmployees = employees.map(e => ({
      uid: e.uid,
      name: `${e.firstName} ${e.lastName}`,
      email: e.email
    }));
    res.json({ success: true, data: formattedEmployees });
  } catch (err) {
    handleError(err, res);
  }
});

// Get all active grants for an employee (for termination modal)
router.get('/:employee_uid/grants', isAuthenticated, isAdmin, async (req, res) => {
  const employeeUid = req.params.employee_uid;
  const tenantUid = req.session.tenant_uid;
  const db = require('../db');
  const grants = db.all(`SELECT * FROM grant_record WHERE employee_uid = ? AND tenant_uid = ? AND status = 'active' AND deleted_at IS NULL`, [employeeUid, tenantUid]);
  // For each grant, get vested/unvested shares
  const vestingModel = require('../services/vesting');
  const grantDetails = grants.map(grant => {
    const vesting = vestingModel.getVestingSummary(grant.grant_uid, tenantUid);
    return {
      ...grant,
      vested: vesting.vested,
      unvested: vesting.unvested
    };
  });
  res.json({ success: true, grants: grantDetails });
});

// Get vesting summary for an employee as of a specific date (for termination modal)
router.get('/:employee_uid/vesting-summary', isAuthenticated, isAdmin, (req, res) => {
  const employeeUid = req.params.employee_uid;
  const tenantUid = req.tenantUid || req.session.tenant_uid;
  const timezone = req.session.user?.timezone || 'UTC';
  const date = req.query.date;
  if (!date) {
    return res.status(400).json({ success: false, message: 'Missing date parameter' });
  }
  const grantModel = require('../models/grant');
  const vestingService = require('../services/vesting');
  const db = require('../db');
  // Get all active grants for this employee
  const grants = grantModel.getGrants(tenantUid, { employeeUid, status: 'active', limit: 100 });
  console.log('[DEBUG] /vesting-summary grants:', grants);
  let totalVested = 0;
  let totalUnvested = 0;
  let manualVestedAfterTermination = 0;
  const decimalPlaces = getDisplayDecimalPlaces(tenantUid);
  const grantSummaries = grants.map(grant => {
    try {
      console.log('[DEBUG] Processing grant for vesting summary:', grant);
      const summary = vestingService.calculateVestingForDisplay({
        uid: grant.uid,
        grantDate: grant.grantDate,
        shareAmount: grant.shareAmount,
        inactiveEffectiveDate: grant.inactiveEffectiveDate,
        terminationEffectiveDate: grant.terminationEffectiveDate
      }, date, timezone);
      console.log('[DEBUG] Vesting summary result:', summary);
      totalVested += summary.theoreticalVestedAmount;
      totalUnvested += Math.max(0, parseFloat(grant.shareAmount) - summary.theoreticalVestedAmount);
      // Sum all manual vesting for this grant (regardless of date)
      const manualVestingRow = db.get(
        "SELECT SUM(shares_vested) as manualVested FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ? AND (source LIKE '%manual%' OR source = 'manual')",
        [grant.uid, tenantUid]
      );
      const manualVested = manualVestingRow && manualVestingRow.manualVested ? parseFloat(manualVestingRow.manualVested) : 0;
      manualVestedAfterTermination += manualVested;
      return {
        grantUid: grant.uid,
        vested: summary.theoreticalVestedAmount + manualVested,
        unvested: Math.max(0, parseFloat(grant.shareAmount) - summary.theoreticalVestedAmount - manualVested),
        manualVested: manualVested,
        inactiveEffectiveDate: summary.inactiveEffectiveDate,
        terminationEffectiveDate: summary.terminationEffectiveDate,
        vestingCutoffDate: summary.vestingCutoffDate
      };
    } catch (err) {
      console.error('[ERROR] Error processing grant in vesting summary:', grant, err);
      return {
        grantUid: grant.uid,
        vested: 0,
        unvested: 0,
        manualVested: 0,
        error: err.message
      };
    }
  });
  const explanation = 'Vested shares as of the termination date are calculated based on the original vesting schedule, plus any manual vesting events (regardless of date).';
  res.json({
    success: true,
    vested: totalVested + manualVestedAfterTermination,
    unvested: totalUnvested - manualVestedAfterTermination,
    manualVested: manualVestedAfterTermination,
    totalVestedIncludingManual: totalVested + manualVestedAfterTermination,
    grants: grantSummaries,
    explanation,
    decimalPlaces
  });
});

module.exports = router; 