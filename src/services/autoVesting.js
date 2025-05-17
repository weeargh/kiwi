/**
 * Automatic Vesting Service
 * Handles automatic vesting processing for newly created grants
 * and ensures historical vesting events are properly created
 */

const db = require('../db');
const vestingService = require('./vesting');
const dateUtils = require('../utils/date');
const audit = require('../utils/audit');

/**
 * Process vesting automatically for a newly created grant
 * This is called when a grant with a past date is created
 * 
 * @param {number} grantUid - ID of the grant
 * @param {number} tenantUid - ID of the tenant
 * @param {string} grantDate - The grant date
 * @param {string} timezone - Tenant timezone
 * @param {number} userUid - ID of the user creating the grant
 * @returns {Promise<Array>} - Array of created vesting events
 */
function processNewGrantVesting(grantUid, tenantUid, grantDate, timezone, userUid) {
  console.log(`[AUTO-VESTING] Processing initial vesting for new grant ${grantUid} with grant date ${grantDate}`);
  
  // Get the current date in tenant's timezone
  const currentDate = dateUtils.getCurrentDate(timezone);
  
  // Verify the grant exists and is active
  const grant = db.get(
    `SELECT grant_uid, share_amount, vested_amount, status 
     FROM grant_record 
     WHERE grant_uid = ? AND tenant_uid = ? AND deleted_at IS NULL`,
    [grantUid, tenantUid]
  );
  
  if (!grant) {
    throw new Error(`Grant ${grantUid} not found or not accessible`);
  }
  
  if (grant.status !== 'active') {
    console.log(`[AUTO-VESTING] Grant ${grantUid} is not active (status: ${grant.status}), skipping vesting calculation`);
    return [];
  }
  
  // Check if grant date is in the past
  if (grantDate >= currentDate) {
    console.log(`[AUTO-VESTING] Grant date ${grantDate} is not in the past, no initial vesting needed`);
    return [];
  }
  
  // Process vesting - use the backdated vesting logic for grants with past dates
  // Get the grant date in the tenant's timezone
  const grantDateTime = dateUtils.parseDate(grantDate, timezone);
  
  // Check if we should bypass cliff (grant date > 12 months ago)
  const twelveMonthsAgo = dateUtils.parseDate(currentDate, timezone).minus({ months: 12 });
  const bypassCliff = grantDateTime <= twelveMonthsAgo;
  
  // Track that we're processing this grant
  recordVestingProcessingStatus(grantUid, tenantUid, userUid);
  
  try {
    let events = [];
    
    if (bypassCliff) {
      console.log(`[AUTO-VESTING] Grant date ${grantDate} is more than 12 months old, bypassing cliff restriction`);
      events = vestingService.processBackdatedVesting(grantUid, tenantUid, grantDate, timezone, userUid);
    } else {
      console.log(`[AUTO-VESTING] Grant date ${grantDate} is less than 12 months old, using standard vesting process`);
      events = vestingService.processGrantVesting(grantUid, tenantUid, currentDate, timezone, userUid);
    }
    
    // Update the processing status to complete
    updateVestingProcessingStatus(grantUid, tenantUid, 'complete', 
      `Successfully processed ${events.length} vesting events`);
    
    console.log(`[AUTO-VESTING] Created ${events.length} vesting events for grant ${grantUid}`);
    return events;
  } catch (error) {
    console.error(`[AUTO-VESTING] Error processing initial vesting for grant ${grantUid}:`, error);
    // Update the status to indicate there was an error
    updateVestingProcessingStatus(grantUid, tenantUid, 'error', error.message);
    throw error;
  }
}

/**
 * Record that a vesting processing job is starting for a grant
 * @param {number} grantUid - ID of the grant
 * @param {number} tenantUid - ID of the tenant
 * @param {number} userUid - ID of the user
 * @returns {Promise<Object>} - Created record
 */
function recordVestingProcessingStatus(grantUid, tenantUid, userUid) {
  const currentDate = new Date().toISOString().split('T')[0];
  
  try {
    const result = db.run(
      `INSERT INTO vesting_processing_status (
        grant_uid, tenant_uid, last_processed_date, status, created_by
      ) VALUES (?, ?, ?, ?, ?)`,
      [grantUid, tenantUid, currentDate, 'processing', userUid]
    );
    
    return {
      id: result.lastID,
      grantUid,
      tenantUid,
      lastProcessedDate: currentDate,
      status: 'processing'
    };
  } catch (error) {
    console.error(`Error recording vesting processing status:`, error);
    // This error shouldn't stop the vesting process
    return null;
  }
}

/**
 * Update the status of a vesting processing job
 * @param {number} grantUid - ID of the grant
 * @param {number} tenantUid - ID of the tenant
 * @param {string} status - New status (complete, error, etc.)
 * @param {string} message - Optional message (for errors)
 * @returns {Promise<boolean>} - Success status
 */
function updateVestingProcessingStatus(grantUid, tenantUid, status, message = null) {
  const currentDate = new Date().toISOString().split('T')[0];
  
  try {
    // Find the latest record ID first
    const latestRecord = db.get(
      `SELECT id FROM vesting_processing_status 
       WHERE grant_uid = ? AND tenant_uid = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [grantUid, tenantUid]
    );
    
    if (!latestRecord) {
      console.log(`No processing record found for grant ${grantUid}`);
      return false;
    }
    
    // Then update that specific record by ID
    db.run(
      `UPDATE vesting_processing_status 
       SET status = ?, 
           last_processed_date = ?,
           message = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, currentDate, message, latestRecord.id]
    );
    
    return true;
  } catch (error) {
    console.error(`Error updating vesting processing status:`, error);
    return false;
  }
}

module.exports = {
  processNewGrantVesting,
  recordVestingProcessingStatus,
  updateVestingProcessingStatus
};
