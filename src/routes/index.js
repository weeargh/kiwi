const express = require('express');
const router = express.Router();
const db = require('../db');
const { isAuthenticated, isEmployeeAuthenticated } = require('../middlewares/auth');
const decimal = require('../utils/decimal');
const dateUtils = require('../utils/date');
const { getDisplayDecimalPlaces } = require('../models/tenant');
const { formatForTenantDisplay } = require('../utils/formatForTenantDisplay');

// GET / - Home page
router.get('/', isAuthenticated, (req, res) => {
  try {
    const userUid = req.session.user.user_uid;
    const tenantUid = req.session.user.tenant_uid;
    const timezone = req.session.user.timezone;
    const isAdmin = req.session.user.role === 'admin';
    // Fetch tenant decimal setting
    const decimalPlaces = getDisplayDecimalPlaces(tenantUid);
    
    // Dashboard data
    const dashboardData = {};
    
    // Get pool metrics
    const pool = db.get(
      'SELECT pool_uid, initial_amount, total_pool FROM equity_pool WHERE tenant_uid = ? AND deleted_at IS NULL',
      [tenantUid]
    );
    
    if (pool) {
      dashboardData.pool = {
        uid: pool.pool_uid,
        initialAmount: formatForTenantDisplay(pool.initial_amount, decimalPlaces),
        totalPool: formatForTenantDisplay(pool.total_pool, decimalPlaces)
      };
      
      // Calculate granted shares
      const grantedResult = db.get(
        `SELECT SUM(share_amount) as granted
        FROM grant_record
        WHERE tenant_uid = ? AND status = 'active' AND deleted_at IS NULL`,
        [tenantUid]
      );
      dashboardData.pool.granted = formatForTenantDisplay(grantedResult.granted || 0, decimalPlaces);
      
      // Calculate returned unvested shares
      const returnedResult = db.get(
        `SELECT SUM(unvested_shares_returned) as returned
        FROM grant_record
        WHERE tenant_uid = ? AND status = 'inactive' AND deleted_at IS NULL`,
        [tenantUid]
      );
      dashboardData.pool.returned = formatForTenantDisplay(returnedResult.returned || 0, decimalPlaces);
      
      // Calculate available shares
      const totalPool = parseFloat(dashboardData.pool.totalPool);
      const granted = parseFloat(dashboardData.pool.granted);
      const returned = parseFloat(dashboardData.pool.returned);
      dashboardData.pool.available = formatForTenantDisplay(totalPool - granted + returned, decimalPlaces);
    }
    
    // Get current PPS
    const currentPPS = db.get(
      `SELECT 
        pps_uid, 
        effective_date, 
        price_per_share 
      FROM pps_history 
      WHERE tenant_uid = ? AND effective_date <= date('now') AND deleted_at IS NULL
      ORDER BY effective_date DESC, created_at DESC 
      LIMIT 1`,
      [tenantUid]
    );
    
    if (currentPPS) {
      dashboardData.pps = {
        uid: currentPPS.pps_uid,
        effectiveDate: dateUtils.formatDate(currentPPS.effective_date, timezone),
        pricePerShare: Number(currentPPS.price_per_share).toFixed(2)
      };
    }
    
    // For admin user, add more stats
    if (isAdmin) {
      // Recent grants
      const recentGrants = db.query(
        `SELECT 
          g.grant_uid, 
          g.employee_uid, 
          g.grant_date, 
          g.share_amount, 
          g.vested_amount,
          g.share_amount - g.vested_amount as unvested_amount,
          g.status,
          e.first_name,
          e.last_name
        FROM grant_record g
        JOIN employee e ON g.employee_uid = e.employee_uid
        WHERE g.tenant_uid = ? AND g.deleted_at IS NULL
        ORDER BY g.created_at DESC
        LIMIT 5`,
        [tenantUid]
      );
      
      dashboardData.recentGrants = recentGrants.map(grant => ({
        uid: grant.grant_uid,
        employeeUid: grant.employee_uid,
        employeeName: `${grant.first_name} ${grant.last_name}`,
        grantDate: dateUtils.formatDate(grant.grant_date, timezone),
        shareAmount: formatForTenantDisplay(grant.share_amount, decimalPlaces),
        vestedAmount: formatForTenantDisplay(grant.vested_amount, decimalPlaces),
        unvestedAmount: formatForTenantDisplay(grant.unvested_amount, decimalPlaces),
        status: grant.status
      }));
      
      // Employee count
      const employeeCount = db.get(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active
        FROM employee
        WHERE tenant_uid = ? AND deleted_at IS NULL`,
        [tenantUid]
      );
      
      dashboardData.employees = {
        total: employeeCount.total,
        active: employeeCount.active
      };
      
      // Recent vesting events
      const recentVesting = db.query(
        `SELECT 
          v.vesting_uid,
          v.grant_uid,
          v.vest_date,
          v.shares_vested,
          v.pps_snapshot,
          e.first_name,
          e.last_name,
          e.employee_uid
        FROM vesting_event v
        JOIN grant_record g ON v.grant_uid = g.grant_uid
        JOIN employee e ON g.employee_uid = e.employee_uid
        WHERE v.tenant_uid = ?
        ORDER BY v.vest_date DESC
        LIMIT 5`,
        [tenantUid]
      );
      
      dashboardData.recentVesting = recentVesting.map(event => ({
        uid: event.vesting_uid,
        grantUid: event.grant_uid,
        employeeUid: event.employee_uid,
        employeeName: `${event.first_name} ${event.last_name}`,
        vestDate: dateUtils.formatDate(event.vest_date, timezone),
        sharesVested: formatForTenantDisplay(event.shares_vested, decimalPlaces),
        ppsSnapshot: event.pps_snapshot ? formatForTenantDisplay(event.pps_snapshot, decimalPlaces) : 'N/A',
        value: event.pps_snapshot ? 
          formatForTenantDisplay(decimal.multiply(event.shares_vested, event.pps_snapshot), decimalPlaces) : 
          'N/A'
      }));
    } else {
      // For employee user, show their own grants
      // First fetch the employee record
      const employee = db.get(
        `SELECT employee_uid, first_name, last_name, status
        FROM employee
        WHERE tenant_uid = ? AND email = ? AND deleted_at IS NULL`,
        [tenantUid, req.session.user.email]
      );
      
      if (employee) {
        // Store employee UID in session for later use
        req.session.user.employee_uid = employee.employee_uid;
        
        // Get employee grants
        const myGrants = db.query(
          `SELECT 
            grant_uid, 
            grant_date, 
            share_amount, 
            vested_amount,
            share_amount - vested_amount as unvested_amount,
            status
          FROM grant_record
          WHERE tenant_uid = ? AND employee_uid = ? AND deleted_at IS NULL
          ORDER BY grant_date DESC`,
          [tenantUid, employee.employee_uid]
        );
        
        dashboardData.myGrants = myGrants.map(grant => ({
          uid: grant.grant_uid,
          grantDate: dateUtils.formatDate(grant.grant_date, timezone),
          shareAmount: formatForTenantDisplay(grant.share_amount, decimalPlaces),
          vestedAmount: formatForTenantDisplay(grant.vested_amount, decimalPlaces),
          unvestedAmount: formatForTenantDisplay(grant.unvested_amount, decimalPlaces),
          status: grant.status
        }));
        
        // Get total vested value
        if (currentPPS) {
          let totalVestedValue = 0;
          for (const grant of myGrants) {
            totalVestedValue = decimal.add(
              totalVestedValue, 
              decimal.multiply(grant.vested_amount, currentPPS.price_per_share)
            );
          }
          dashboardData.totalVestedValue = formatForTenantDisplay(totalVestedValue, decimalPlaces);
          dashboardData.currency = req.session.user.currency;
        }
        
        // Get recent vesting events
        const myVesting = db.query(
          `SELECT 
            v.vesting_uid,
            v.grant_uid,
            v.vest_date,
            v.shares_vested,
            v.pps_snapshot
          FROM vesting_event v
          JOIN grant_record g ON v.grant_uid = g.grant_uid
          WHERE g.employee_uid = ? AND v.tenant_uid = ?
          ORDER BY v.vest_date DESC
          LIMIT 5`,
          [employee.employee_uid, tenantUid]
        );
        
        dashboardData.myVesting = myVesting.map(event => ({
          uid: event.vesting_uid,
          grantUid: event.grant_uid,
          vestDate: dateUtils.formatDate(event.vest_date, timezone),
          sharesVested: formatForTenantDisplay(event.shares_vested, decimalPlaces),
          ppsSnapshot: event.pps_snapshot ? formatForTenantDisplay(event.pps_snapshot, decimalPlaces) : 'N/A',
          value: event.pps_snapshot ? 
            formatForTenantDisplay(decimal.multiply(event.shares_vested, event.pps_snapshot), decimalPlaces) : 
            'N/A'
        }));
      }
    }
    
    // Render dashboard
    res.render('dashboard', {
      title: 'Dashboard',
      data: dashboardData,
      isAdmin,
      decimalPlaces,
      user: req.session.user || null,
      employee: req.session.employee || null
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.render('dashboard', {
      title: 'Dashboard',
      error: 'An error occurred while loading the dashboard.',
      data: {},
      isAdmin: req.session.user && req.session.user.role === 'admin',
      decimalPlaces: 0,
      user: req.session && req.session.user || null,
      employee: req.session && req.session.employee || null
    });
  }
});

/**
 * CSRF token verification route - useful for debugging
 * Only available in development environment
 */
router.get('/csrf-check', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).send('Not found');
  }
  
  // Check if CSRF token is available
  const hasToken = !!res.locals.csrfToken;
  
  // Send diagnostic information
  res.send(`
    <h1>CSRF Token Diagnostic</h1>
    <p>CSRF Token available: ${hasToken ? 'Yes' : 'No'}</p>
    <p>Token value: ${hasToken ? res.locals.csrfToken : 'Not available'}</p>
    <p>Current Time: ${new Date().toISOString()}</p>
    <p>App Environment: ${process.env.NODE_ENV || 'development'}</p>
    <p>Session ID: ${req.session ? req.session.id : 'No session'}</p>
    <hr>
    <h2>Form Test</h2>
    <form method="POST" action="/csrf-test">
      <input type="hidden" name="_csrf" value="${res.locals.csrfToken || ''}">
      <button type="submit">Test CSRF Protection</button>
    </form>
  `);
});

/**
 * CSRF token test endpoint
 */
router.post('/csrf-test', (req, res) => {
  res.send('CSRF validation passed! Form submission successful.');
});

// Employee dashboard route
router.get('/employee/dashboard', isEmployeeAuthenticated, (req, res) => {
  try {
    const employee = req.session.employee;
    if (!employee) {
      return res.redirect('/auth/employee-login');
    }
    // Get tenant settings for decimal places
    const tenant = db.get('SELECT display_decimal_places, currency, name FROM tenant WHERE tenant_uid = ?', [employee.tenant_uid]);
    // Get grants for this employee
    const grants = db.query(
      `SELECT g.grant_uid, g.grant_date, g.share_amount, g.vested_amount, g.status, g.termination_date, g.unvested_shares_returned,
              (SELECT price_per_share FROM pps_history WHERE tenant_uid = g.tenant_uid AND effective_date <= g.grant_date ORDER BY effective_date DESC LIMIT 1) as pps_at_grant
       FROM grant_record g
       WHERE g.tenant_uid = ? AND g.employee_uid = ? AND g.deleted_at IS NULL
       ORDER BY g.grant_date DESC`,
      [employee.tenant_uid, employee.employee_uid]
    );
    // Calculate stats
    let totalGranted = 0, totalVested = 0, totalUnvested = 0, totalValue = 0;
    grants.forEach(grant => {
      totalGranted += grant.share_amount;
      totalVested += grant.vested_amount;
      totalUnvested += (grant.share_amount - grant.vested_amount);
      if (grant.pps_at_grant) {
        totalValue += grant.vested_amount * grant.pps_at_grant;
      }
    });
    // If terminated, calculate returned and kept by employee
    let returned = 0, keptByEmployee = 0;
    if (employee.status === 'terminated') {
      // Returned: sum of unvested_shares_returned for this employee
      returned = grants.reduce((sum, grant) => sum + (grant.unvested_shares_returned || 0), 0);
      // Kept by Employee: sum of vested_amount for terminated grants
      keptByEmployee = grants.reduce((sum, grant) => grant.status === 'inactive' || grant.status === 'terminated' ? sum + (grant.vested_amount || 0) : sum, 0);
    }
    res.render('employee-dashboard', {
      title: 'My Grants',
      employee: employee || null,
      user: req.session.user || null,
      grants: Array.isArray(grants) ? grants : [],
      stats: {
        totalGranted: totalGranted || 0,
        totalVested: totalVested || 0,
        totalUnvested: totalUnvested || 0,
        totalValue: totalValue || 0,
        returned: returned || 0,
        keptByEmployee: keptByEmployee || 0
      },
      decimalPlaces: tenant ? tenant.display_decimal_places : 2,
      currency: tenant ? tenant.currency : ''
    });
  } catch (err) {
    console.error('Employee dashboard error:', err);
    res.status(500).render('employee-dashboard', {
      title: 'My Grants',
      employee: {},
      user: req.session.user || null,
      grants: [],
      stats: {
        totalGranted: 0,
        totalVested: 0,
        totalUnvested: 0,
        totalValue: 0,
        returned: 0,
        keptByEmployee: 0
      },
      decimalPlaces: 2,
      currency: ''
    });
  }
});

module.exports = router; 