/**
 * Vesting Batch Processing Service
 * Handles improved daily vesting batch processing with better reliability
 * and proper handling of tenant timezones.
 */

const db = require('../db');
const vestingService = require('./vesting');
const dateUtils = require('../utils/date');
const autoVestingService = require('./autoVesting');
const { DateTime } = require('luxon');

/**
 * Process vesting for all tenants, respecting their timezones
 * This is the main entry point for the daily batch job
 * 
 * @returns {Promise<Object>} - Batch processing results
 */
function processAllTenants() {
  console.log('Starting daily batch vesting processing...');
  
  // Get all active tenants
  const tenants = db.query(
    `SELECT tenant_uid, name, timezone FROM tenant WHERE deleted_at IS NULL`,
    []
  );
  
  console.log(`Found ${tenants.length} active tenants`);
  
  const results = {
    tenants: tenants.length,
    processed: 0,
    skipped: 0,
    errors: [],
    totalEvents: 0,
    tenantResults: []
  };
  
  // Process each tenant
  for (const tenant of tenants) {
    try {
      console.log(`Processing tenant ${tenant.name} (${tenant.tenant_uid})`);
      
      // Get the current date in tenant's timezone
      const tenantCurrentDate = dateUtils.getCurrentDate(tenant.timezone);
      console.log(`Current date in tenant timezone (${tenant.timezone}): ${tenantCurrentDate}`);
      
      // Process vesting for this tenant
      const tenantResult = processTenantVesting(tenant.tenant_uid, tenant.timezone, 1); // Admin user ID
      
      results.tenantResults.push({
        tenantUid: tenant.tenant_uid,
        tenantName: tenant.name,
        processed: tenantResult.processed,
        skipped: tenantResult.skipped,
        errors: tenantResult.errors.length,
        events: tenantResult.createdEvents
      });
      
      results.processed += tenantResult.processed;
      results.skipped += tenantResult.skipped;
      results.totalEvents += tenantResult.createdEvents;
      results.errors = results.errors.concat(tenantResult.errors);
      
      console.log(`Completed processing for tenant ${tenant.name}: processed ${tenantResult.processed} grants, created ${tenantResult.createdEvents} events`);
    } catch (error) {
      console.error(`Error processing tenant ${tenant.name} (${tenant.tenant_uid}):`, error);
      results.errors.push({
        tenantUid: tenant.tenant_uid,
        error: error.message
      });
    }
  }
  
  console.log(`Batch vesting complete: processed ${results.processed} grants across ${results.tenants} tenants, created ${results.totalEvents} events, ${results.errors.length} errors`);
  
  return results;
}

/**
 * Process vesting for all grants in a tenant
 * Improved version with better error handling and tracking
 * 
 * @param {number} tenantUid - UID of the tenant
 * @param {string} timezone - Tenant timezone
 * @param {number} userUid - UID of the user processing the batch
 * @returns {Promise<Object>} - Results of the batch processing
 */
function processTenantVesting(tenantUid, timezone, userUid) {
  // Get the current date in tenant's timezone
  const currentDate = dateUtils.getCurrentDate(timezone);
  console.log(`Processing tenant ${tenantUid} grants up to ${currentDate}`);
  
  // Get all grants that need processing:
  // 1. Active grants
  // 2. With grant date before or equal to current date
  const grants = db.query(
    `SELECT 
      g.grant_uid, 
      g.grant_date, 
      g.employee_uid,
      g.version,
      e.first_name || ' ' || e.last_name as employee_name
     FROM grant_record g
     JOIN employee e ON g.employee_uid = e.employee_uid AND e.tenant_uid = g.tenant_uid
     WHERE g.tenant_uid = ? 
       AND g.status = 'active' 
       AND g.deleted_at IS NULL
       AND g.grant_date <= ?
     ORDER BY g.grant_date ASC`,
    [tenantUid, currentDate]
  );
  
  console.log(`Found ${grants.length} active grants to process`);
  
  const results = {
    processed: 0,
    skipped: 0,
    errors: [],
    createdEvents: 0,
    processedGrants: []
  };
  
  // Check for grants that have never been processed
  checkForNeverProcessedGrants(grants, tenantUid, timezone, userUid);
  
  // Process each grant
  for (const grant of grants) {
    try {
      console.log(`Processing grant ${grant.grant_uid} for ${grant.employee_name} (granted on ${grant.grant_date})`);
      
      // Record vesting processing status before starting
      autoVestingService.recordVestingProcessingStatus(grant.grant_uid, tenantUid, userUid);
      
      // Process the grant
      const events = vestingService.processGrantVesting(
        grant.grant_uid, 
        tenantUid, 
        currentDate, 
        timezone, 
        userUid
      );
      
      // Update vesting processing status
      const status = (events && events.length > 0) ? 'completed' : 'no_action_needed';
      autoVestingService.updateVestingProcessingStatus(grant.grant_uid, tenantUid, status);
      
      // Fix: Check if events exists and has a length property
      const eventsCreated = events && events.length ? events.length : 0;
      
      if (eventsCreated > 0) {
        results.processed++;
        results.createdEvents += eventsCreated;
        results.processedGrants.push({
          grantUid: grant.grant_uid,
          grantDate: grant.grant_date,
          employeeName: grant.employee_name,
          eventsCreated: eventsCreated
        });
        console.log(`Created ${eventsCreated} vesting events for grant ${grant.grant_uid}`);
      } else {
        results.skipped++;
        console.log(`No new vesting events needed for grant ${grant.grant_uid}`);
      }
    } catch (err) {
      console.error(`Error processing vesting for grant ${grant.grant_uid}:`, err);
      
      // Update status to reflect error
      autoVestingService.updateVestingProcessingStatus(
        grant.grant_uid, 
        tenantUid, 
        'error', 
        err.message
      );
      
      results.errors.push({
        grantUid: grant.grant_uid,
        error: err.message
      });
    }
  }
  
  console.log(`Tenant ${tenantUid} vesting complete: processed ${results.processed} grants, created ${results.createdEvents} events, skipped ${results.skipped} grants, ${results.errors.length} errors`);
  
  return results;
}

/**
 * Check for grants that have never been processed for vesting
 * This helps catch any grants that might have been missed during normal processing
 * 
 * @param {Array} grants - List of active grants
 * @param {number} tenantUid - Tenant UID
 * @param {string} timezone - Tenant timezone
 * @param {number} userUid - User UID
 */
function checkForNeverProcessedGrants(grants, tenantUid, timezone, userUid) {
  if (!grants || grants.length === 0) return;
  
  console.log(`Checking for grants that have never been processed...`);
  
  // Get list of grants that have vesting processing records
  const processedGrantUids = db.query(
    `SELECT DISTINCT grant_uid FROM vesting_processing_status WHERE tenant_uid = ?`,
    [tenantUid]
  );
  
  const processedSet = new Set(processedGrantUids.map(g => g.grant_uid));
  
  // Find grants that have never been processed
  const neverProcessed = grants.filter(g => !processedSet.has(g.grant_uid));
  
  if (neverProcessed.length > 0) {
    console.log(`Found ${neverProcessed.length} grants that have never been processed for vesting`);
    
    // Current date in tenant's timezone
    const currentDate = dateUtils.getCurrentDate(timezone);
    
    for (const grant of neverProcessed) {
      console.log(`Processing previously missed grant ${grant.grant_uid}`);
      
      try {
        // Check if grant needs backdated processing
        const grantDateTime = DateTime.fromISO(grant.grant_date);
        const currentDateTime = DateTime.fromISO(currentDate);
        const monthsSinceGrant = currentDateTime.diff(grantDateTime, 'months').months;
        
        if (monthsSinceGrant >= 12) {
          // Grant is over 12 months old, use backdated processing
          console.log(`Grant ${grant.grant_uid} is over 12 months old, using backdated processing`);
          autoVestingService.processNewGrantVesting(
            grant.grant_uid,
            tenantUid,
            grant.grant_date,
            timezone,
            userUid
          );
        }
        // Standard processing will happen in the main loop
      } catch (error) {
        console.error(`Error processing previously missed grant ${grant.grant_uid}:`, error);
      }
    }
  } else {
    console.log(`All grants have been processed at least once`);
  }
}

/**
 * Run the daily vesting batch job
 * This should be called by the scheduled job
 */
function runDailyBatch() {
  console.log(`Starting daily vesting batch job at ${new Date().toISOString()}`);
  
  try {
    const results = processAllTenants();
    console.log(`Daily batch completed: processed ${results.processed} grants across ${results.tenants} tenants`);
    return results;
  } catch (error) {
    console.error(`Error running daily vesting batch:`, error);
    throw error;
  }
}

module.exports = {
  processAllTenants,
  processTenantVesting,
  runDailyBatch
};
