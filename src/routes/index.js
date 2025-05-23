const express = require('express');
const router = express.Router();
const db = require('../db');
const { isAuthenticated, isAdmin } = require('../middlewares/auth');
const decimal = require('../utils/decimal');
const dateUtils = require('../utils/date');
const { getDisplayDecimalPlaces } = require('../models/tenant');
const { formatForTenantDisplay } = require('../utils/formatForTenantDisplay');
const chartCache = require('../services/chartCache');
const poolModel = require('../models/pool');

// GET / - Home page
router.get('/', isAuthenticated, (req, res) => {
  try {
    // Use req.session.auth as the source of truth
    const authUser = req.session.auth; 
    if (!authUser) {
      // This should ideally not happen if isAuthenticated middleware is working correctly
      // and session upgrade middleware has run.
      console.error('CRITICAL: req.session.auth is missing in dashboard route after isAuthenticated.');
      req.flash('error', 'Session error. Please log in again.');
      return res.redirect('/auth/login');
    }

    const userUid = authUser.user_uid; // For admins, user_uid is directly on auth
    const tenantUid = authUser.tenant_uid;
    const timezone = authUser.timezone;
    const isAdminUser = authUser.role === 'admin'; // Renamed to avoid conflict with isAdmin variable passed to template
    
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

      // Get kept by employee shares from pool model for accurate calculation
      const keptByEmployee = poolModel.getKeptByEmployeeShares(tenantUid);
      const formattedKeptByEmployee = formatForTenantDisplay(keptByEmployee, decimalPlaces);
      dashboardData.pool.keptByEmployee = formattedKeptByEmployee;

      // Update calculation to match pool model's formula: available = totalPool - granted - keptByEmployee
      dashboardData.pool.available = formatForTenantDisplay(totalPool - granted - keptByEmployee, decimalPlaces);
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
    if (isAdminUser) {
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
    } else { // This block is for when isAdminUser is false, implying it's an employee if isEmployeeAuthenticated was used,
             // or if the main dashboard needs to show limited info for non-admin 'user' roles if such exist.
             // Given the error was on admin dashboard, this part is less critical for *this specific error*
             // but should be reviewed for consistency with req.session.auth.
             // For now, assuming the primary dashboard is admin-focused.
             // If this route is also meant for employees, it should use isEmployeeAuthenticated
             // and req.session.auth.employee_uid etc.

      // For employee user (if this route handles them, which it seems to try to do):
      // Ensure tenantUid is from authUser for safety, though it should be the same.
      const currentTenantUid = authUser.tenant_uid;
      const employeeEmail = authUser.email; // email is on authUser for both admin and employee
      const employeeDetails = db.get( // Renamed 'employee' to 'employeeDetails' to avoid conflict with res.locals.employee
        `SELECT employee_uid, first_name, last_name, status
        FROM employee
        WHERE tenant_uid = ? AND email = ? AND deleted_at IS NULL`,
        [currentTenantUid, employeeEmail]
      );
      
      if (employeeDetails) {
        // If you need to store employee_uid back into session (though it should already be there if login was correct)
        // req.session.auth.employee_uid = employeeDetails.employee_uid; // Be cautious with modifying session here

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
          [currentTenantUid, employeeDetails.employee_uid]
        );
        
        dashboardData.myGrants = myGrants.map(grant => ({
          uid: grant.grant_uid,
          grantDate: dateUtils.formatDate(grant.grant_date, authUser.timezone), // Use timezone from authUser
          shareAmount: formatForTenantDisplay(grant.share_amount, decimalPlaces),
          vestedAmount: formatForTenantDisplay(grant.vested_amount, decimalPlaces),
          unvestedAmount: formatForTenantDisplay(grant.unvested_amount, decimalPlaces),
          status: grant.status
        }));
        
        if (currentPPS) {
          let totalVestedValue = 0;
          for (const grant of myGrants) {
            totalVestedValue = decimal.add(
              totalVestedValue, 
              decimal.multiply(grant.vested_amount, currentPPS.price_per_share)
            );
          }
          dashboardData.totalVestedValue = formatForTenantDisplay(totalVestedValue, decimalPlaces);
          dashboardData.currency = authUser.currency; // Use currency from authUser
        }
        
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
          [employeeDetails.employee_uid, currentTenantUid] // Use employeeDetails.employee_uid and currentTenantUid
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
    
    // Get cached chart data (or create new cache)
    const forceRefresh = req.query.refresh === 'true';
    let poolChartData = { data: {} };
    let vestingChartData = { data: {} };
    
    if (isAdminUser) {
      // Only retrieve chart data for admin users
      poolChartData = chartCache.getPoolChartData(tenantUid, forceRefresh);
      vestingChartData = chartCache.getVestingChartData(tenantUid, forceRefresh);
    }
    
    // Format the timestamp for display
    const chartLastUpdated = poolChartData.timestamp ? 
      chartCache.formatTimestamp(poolChartData.timestamp) : 
      'Never';
    
    // Render dashboard
    res.render('dashboard', {
      title: 'Dashboard',
      data: dashboardData,
      isAdmin: isAdminUser, // Pass the correct isAdmin variable
      decimalPlaces,
      auth: authUser || res.locals.auth || {}, // Ensure auth is always defined
      chartData: {
        pool: poolChartData.data,
        vesting: vestingChartData.data,
        lastUpdated: chartLastUpdated
      }
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    const authUserFromSessionOnError = req.session && req.session.auth; // Safely get auth from session for error case
    res.render('dashboard', {
      title: 'Dashboard',
      error: 'An error occurred while loading the dashboard.',
      data: {},
      isAdmin: authUserFromSessionOnError && authUserFromSessionOnError.role === 'admin', // Safely derive isAdmin
      decimalPlaces: getDisplayDecimalPlaces(authUserFromSessionOnError ? authUserFromSessionOnError.tenant_uid : null), // Safely get decimal places
      auth: authUserFromSessionOnError || res.locals.auth || {} // Ensure auth is always defined, never undefined
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

// Employee dashboard route has been removed
// A dedicated employee portal will handle employee access instead
router.get('/employee/dashboard', isAuthenticated, isAdmin, (req, res) => {
  // Redirect admins to main dashboard
  req.flash('info', 'Employee dashboard has been moved to a separate portal application');
  return res.redirect('/');
});

module.exports = router;
