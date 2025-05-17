const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middlewares/auth');
const vestingService = require('../services/vesting');
const db = require('../db');
const { handleError } = require('../utils/response');
const dateUtils = require('../utils/date');
const decimal = require('../utils/decimal');

/**
 * GET /vesting
 * Main vesting dashboard
 */
router.get('/', isAuthenticated, (req, res) => {
  try {
    console.log('Vesting dashboard requested');
    const tenantUid = req.session.user.tenant_uid;
    
    // Fetch active grants with vesting info
    const grants = db.query(
      `SELECT 
        g.grant_uid as uid, 
        g.employee_uid as employeeUid,
        e.first_name || ' ' || e.last_name as employeeName,
        g.grant_date as grantDate, 
        g.share_amount as shareAmount, 
        g.vested_amount as vestedAmount
       FROM grant_record g
       JOIN employee e ON g.employee_uid = e.employee_uid AND e.tenant_uid = g.tenant_uid
       WHERE g.tenant_uid = ? AND g.status = 'active' AND g.deleted_at IS NULL
       ORDER BY g.grant_date DESC`,
      [tenantUid]
    );
    
    // Format grants for display
    const formattedGrants = grants.map(grant => {
      // Calculate vested percentage
      let vestedPercent = '0%';
      if (parseFloat(grant.shareAmount) > 0) {
        const percent = (parseFloat(grant.vestedAmount) / parseFloat(grant.shareAmount) * 100).toFixed(1);
        vestedPercent = `${percent}%`;
      }
      
      // Format date for display
      const grantDate = dateUtils.formatDate(grant.grantDate, req.session.user.timezone || 'UTC');
      
      return {
        ...grant,
        grantDate,
        shareAmount: decimal.format(grant.shareAmount),
        vestedAmount: decimal.format(grant.vestedAmount),
        vestedPercent
      };
    });
    
    // Render with layout
    res.render('vesting/index', {
      title: 'Vesting Dashboard',
      grants: formattedGrants,
      isAdmin: req.session.user.role === 'admin'
    });
  } catch (err) {
    console.error('Error loading vesting dashboard:', err);
    return handleError(err, res);
  }
});

/**
 * POST /vesting/calculate/:grantUid
 * Calculate vesting for a specific grant up to the current date
 * Creates vesting events for any vesting dates that have passed
 */
router.post('/calculate/:grantUid', isAuthenticated, isAdmin, (req, res) => {
  try {
    const grantUid = req.params.grantUid;
    const tenantUid = req.session.user.tenant_uid;
    const userUid = req.session.user.user_uid;
    const timezone = req.session.user.timezone;
    
    // Use current date in tenant timezone
    const currentDate = dateUtils.getCurrentDate(timezone);
    
    // Process vesting for this grant
    const events = vestingService.processGrantVesting(
      grantUid, 
      tenantUid, 
      currentDate,
      timezone,
      userUid
    );
    
    // Return success with the number of vesting events created
    return res.json({
      success: true,
      message: `Created ${events.length} vesting events`,
      data: {
        eventsCreated: events.length,
        grantUid
      }
    });
  } catch (err) {
    console.error('Error calculating vesting:', err);
    return handleError(err, res);
  }
});

/**
 * POST /vesting/batch-calculate
 * Run batch vesting calculation for all grants in the tenant
 * Admin only endpoint
 */
router.post('/batch-calculate', isAuthenticated, isAdmin, (req, res) => {
  try {
    const tenantUid = req.session.user.tenant_uid;
    const userUid = req.session.user.user_uid;
    const timezone = req.session.user.timezone;
    
    // Process batch vesting for all grants
    const results = vestingService.processBatchVesting(
      tenantUid,
      timezone,
      userUid
    );
    
    // Return success with detailed results
    return res.json({
      success: true,
      message: `Processed ${results.processed} grants, created ${results.createdEvents} vesting events`,
      data: {
        processed: results.processed,
        skipped: results.skipped,
        createdEvents: results.createdEvents,
        errors: results.errors.length,
        processedGrants: results.processedGrants || []
      }
    });
  } catch (err) {
    console.error('Error running batch vesting:', err);
    return handleError(err, res);
  }
});

/**
 * GET /vesting/schedule/:grantUid
 * Get the full vesting schedule for a grant
 */
router.get('/schedule/:grantUid', isAuthenticated, (req, res) => {
  try {
    const grantUid = req.params.grantUid;
    const tenantUid = req.session.user.tenant_uid;
    const timezone = req.session.user.timezone;
    
    // Get the grant details first
    const grant = db.get(
      `SELECT 
        grant_uid, employee_uid, grant_date, share_amount, vested_amount, status
       FROM grant_record 
       WHERE grant_uid = ? AND tenant_uid = ? AND deleted_at IS NULL`,
      [grantUid, tenantUid]
    );
    
    if (!grant) {
      return res.status(404).json({
        success: false,
        message: 'Grant not found'
      });
    }
    
    // Calculate all vesting dates
    const vestingDates = vestingService.calculateAllVestingDates(grant.grant_date, timezone);
    
    // Calculate tranche sizes
    const tranches = vestingService.calculateVestingTranches(grant.share_amount);
    
    // Get existing vesting events
    const existingEvents = db.query(
      `SELECT vest_date, shares_vested, pps_snapshot, created_at
       FROM vesting_event 
       WHERE grant_uid = ? AND tenant_uid = ?
       ORDER BY vest_date ASC`,
      [grantUid, tenantUid]
    );
    
    // Create a map of existing events by date
    const existingEventsByDate = {};
    existingEvents.forEach(event => {
      existingEventsByDate[event.vest_date] = event;
    });
    
    // Create the full schedule with status
    const currentDate = dateUtils.getCurrentDate(timezone);
    const currentDateObj = dateUtils.parseDate(currentDate, timezone);
    
    const schedule = vestingDates.map((date, index) => {
      const dateObj = dateUtils.parseDate(date, timezone);
      const isPastCliff = index >= 11; // 12-month cliff (0-indexed)
      const isPastDate = dateObj <= currentDateObj;
      const existingEvent = existingEventsByDate[date];
      
      return {
        vestingPeriod: index + 1,
        vestDate: date,
        sharesVested: tranches[index],
        status: existingEvent ? 'vested' : 
                !isPastCliff ? 'cliff' :
                !isPastDate ? 'future' : 'pending',
        ppsSnapshot: existingEvent ? existingEvent.pps_snapshot : null,
        vestedAt: existingEvent ? existingEvent.created_at : null
      };
    });
    
    return res.json({
      success: true,
      data: {
        grantUid: grant.grant_uid,
        employeeUid: grant.employee_uid,
        grantDate: grant.grant_date,
        shareAmount: grant.share_amount,
        vestedAmount: grant.vested_amount,
        status: grant.status,
        schedule
      }
    });
  } catch (err) {
    console.error('Error fetching vesting schedule:', err);
    return handleError(err, res);
  }
});

/**
 * POST /vesting/backdated-calculate/:grantUid
 * Calculate backdated vesting for a grant that was effective before being added to the system
 * Creates vesting events based on an original effective date instead of the grant date in the system
 */
router.post('/backdated-calculate/:grantUid', isAuthenticated, isAdmin, (req, res) => {
  try {
    const grantUid = req.params.grantUid;
    const tenantUid = req.session.user.tenant_uid;
    const userUid = req.session.user.user_uid;
    const timezone = req.session.user.timezone;
    
    // Validate effective date from request body
    if (!req.body.effectiveDate) {
      return res.status(400).json({
        success: false,
        message: 'Effective date is required'
      });
    }
    
    // Use provided effective date (historical grant date)
    const effectiveDate = req.body.effectiveDate;
    
    // Process backdated vesting for this grant
    const events = vestingService.processBackdatedVesting(
      grantUid, 
      tenantUid, 
      effectiveDate,
      timezone,
      userUid
    );
    
    // Return success with the number of vesting events created
    return res.json({
      success: true,
      message: `Created ${events.length} backdated vesting events`,
      data: {
        eventsCreated: events.length,
        grantUid,
        effectiveDate
      }
    });
  } catch (err) {
    console.error('Error calculating backdated vesting:', err);
    return handleError(err, res);
  }
});

/**
 * POST /vesting/auto-backdated/:grantUid
 * Calculate backdated vesting for a grant using its own grant date
 * No need for user to input a date - simplifies backdated vesting process
 */
router.post('/auto-backdated/:grantUid', isAuthenticated, isAdmin, (req, res) => {
  try {
    const grantUid = req.params.grantUid;
    const tenantUid = req.session.user.tenant_uid;
    const userUid = req.session.user.user_uid;
    const timezone = req.session.user.timezone;
    
    // Get the grant details to use its own grant date
    const grant = db.get(
      `SELECT grant_uid, grant_date FROM grant_record 
       WHERE grant_uid = ? AND tenant_uid = ? AND status = 'active' AND deleted_at IS NULL`,
      [grantUid, tenantUid]
    );
    
    if (!grant) {
      return res.status(404).json({
        success: false,
        message: 'Grant not found or not active'
      });
    }
    
    // Use the grant's own date as the effective date
    const effectiveDate = grant.grant_date;
    console.log(`Processing auto-backdated vesting for grant ${grantUid} using its grant date ${effectiveDate}`);
    
    // Process backdated vesting for this grant
    const events = vestingService.processBackdatedVesting(
      grantUid, 
      tenantUid, 
      effectiveDate,
      timezone,
      userUid
    );
    
    // Return success with the number of vesting events created
    return res.json({
      success: true,
      message: `Created ${events.length} backdated vesting events`,
      data: {
        eventsCreated: events.length,
        grantUid,
        effectiveDate
      }
    });
  } catch (err) {
    console.error('Error processing auto-backdated vesting:', err);
    return handleError(err, res);
  }
});

// Alias for calculate-vesting (RESTful, as per spec, backup for direct vesting route)
router.post('/grants/:uid/calculate-vesting', isAuthenticated, isAdmin, (req, res) => {
  const grantUid = req.params.uid;
  const tenantUid = req.session.user.tenant_uid;
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

module.exports = router; 