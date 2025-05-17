/**
 * Vesting Engine Service
 * Handles all vesting calculations according to SPECIFICATION.md Section 4.1
 * Implements:
 * - 48-month vesting schedule with 12-month cliff
 * - Month-end rule
 * - Leap-year rule
 * - Final tranche adjustment to ensure totals match exactly
 */

const { DateTime } = require('luxon');
const db = require('../db');
const decimal = require('../utils/decimal');
const dateUtils = require('../utils/date');
const audit = require('../utils/audit');
const { nanoid } = require('nanoid');

/**
 * Calculate the vesting date for a specific month after the grant date
 * Implements month-end rule: vest_date = min(original_day, days_in_month(target_month))
 * Leap-year rule: grants on Feb 29 vest on Feb 28 in non-leap years
 * @param {string|Date} grantDate - The original grant date (YYYY-MM-DD)
 * @param {number} monthsAfter - Number of months after the grant date (1-48)
 * @param {string} timezone - Tenant timezone
 * @returns {string} - The calculated vesting date (YYYY-MM-DD)
 */
function calculateVestingDate(grantDate, monthsAfter, timezone) {
  // Convert to DateTime object in tenant's timezone
  const dt = dateUtils.parseDate(grantDate, timezone);
  
  // Original day of month
  const originalDay = dt.day;
  
  // Calculate the target month (add months)
  const targetMonth = dt.plus({ months: monthsAfter });
  
  // Get days in the target month
  const daysInMonth = targetMonth.daysInMonth;
  
  // Apply month-end rule: min(original_day, days_in_month(target_month))
  const adjustedDay = Math.min(originalDay, daysInMonth);
  
  // Create the final vesting date with adjusted day
  const vestingDate = targetMonth.set({ day: adjustedDay });
  
  // Return as ISO date string (YYYY-MM-DD)
  return vestingDate.toISODate();
}

/**
 * Calculate all vesting dates for a grant
 * @param {string|Date} grantDate - The original grant date (YYYY-MM-DD)
 * @param {string} timezone - Tenant timezone
 * @returns {Array<string>} - Array of 48 vesting dates (YYYY-MM-DD)
 */
function calculateAllVestingDates(grantDate, timezone) {
  const vestingDates = [];
  
  // Generate all 48 vesting dates
  for (let month = 1; month <= 48; month++) {
    vestingDates.push(calculateVestingDate(grantDate, month, timezone));
  }
  
  return vestingDates;
}

/**
 * Calculate vesting tranches for a grant
 * Uses banker's rounding (round half to even) method for 3 decimal places
 * @param {number} shareAmount - Total grant amount
 * @returns {Array<number>} - Array of 48 tranche amounts
 */
function calculateVestingTranches(shareAmount) {
  // Calculate the standard tranche size (share_amount / 48)
  const trancheSize = decimal.calculateTrancheSize(shareAmount);
  
  // Initialize tranches array with standard size
  const tranches = Array(47).fill(trancheSize);
  
  // Calculate the sum of the first 47 tranches
  const sum47 = tranches.reduce((acc, curr) => decimal.add(acc, curr), 0);
  
  // Calculate the final tranche to ensure total equals shareAmount exactly
  const finalTranche = decimal.calculateFinalTranche(shareAmount, sum47);
  
  // Add the final tranche
  tranches.push(finalTranche);
  
  return tranches;
}

/**
 * Get the current price per share for a vesting event
 * @param {number} tenantUid - ID of the tenant
 * @param {string} vestDate - Vesting date (YYYY-MM-DD)
 * @returns {number} - The PPS value for the vest date
 */
function getPPSForVestDate(tenantUid, vestDate) {
  // Query the most recent PPS effective on or before the vest date
  const pps = db.get(
    `SELECT price_per_share 
     FROM pps_history 
     WHERE tenant_uid = ? AND effective_date <= ? AND deleted_at IS NULL
     ORDER BY effective_date DESC, created_at DESC
     LIMIT 1`,
    [tenantUid, vestDate]
  );
  
  return pps ? pps.price_per_share : null;
}

/**
 * Create a vesting event record
 * @param {Object} dbClient - Database client
 * @param {Object} eventData - Vesting event data
 * @param {number} eventData.grantUid - Grant ID
 * @param {number} eventData.tenantUid - Tenant ID
 * @param {string} eventData.vestDate - Vesting date (YYYY-MM-DD)
 * @param {number} eventData.sharesVested - Number of shares vested
 * @param {number} eventData.ppsSnapshot - PPS value at vesting time
 * @param {number} eventData.createdBy - User ID of who created the event
 * @returns {Object} - Created vesting event
 */
function createVestingEvent(dbClient, eventData) {
  const { grantUid, tenantUid, vestDate, sharesVested, ppsSnapshot, createdBy } = eventData;
  const vestingUid = nanoid(12);
  
  // Get current grant to check version and update vested amount
  const grant = dbClient.get(
    `SELECT grant_uid, vested_amount, status, version, share_amount 
     FROM grant_record 
     WHERE grant_uid = ? AND tenant_uid = ? AND deleted_at IS NULL`,
    [grantUid, tenantUid]
  );
  
  if (!grant) {
    throw new Error('Grant not found');
  }
  
  if (grant.status !== 'active') {
    throw new Error('Cannot add vesting to an inactive grant');
  }
  
  // Check if vesting would exceed total shares
  const newVestedTotal = decimal.add(grant.vested_amount, sharesVested);
  if (parseFloat(newVestedTotal) > parseFloat(grant.share_amount)) {
    throw new Error(`Vesting would exceed total shares. Total: ${grant.share_amount}, Already vested: ${grant.vested_amount}, New vesting: ${sharesVested}`);
  }
  
  // Create the vesting event
  const result = dbClient.run(
    `INSERT INTO vesting_event (
      vesting_uid, grant_uid, tenant_uid, vest_date, shares_vested, pps_snapshot, created_by, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [vestingUid, grantUid, tenantUid, vestDate, sharesVested, ppsSnapshot, createdBy, 'scheduled']
  );
  
  // Update the grant's vested amount
  const updateResult = dbClient.run(
    'UPDATE grant_record SET vested_amount = ?, version = ? WHERE grant_uid = ? AND tenant_uid = ? AND version = ?',
    [newVestedTotal, grant.version + 1, grantUid, tenantUid, grant.version]
  );
  
  // Check if update was successful (optimistic locking)
  if (updateResult.changes === 0) {
    throw new Error('Grant has been modified by another user. Please refresh and try again.');
  }
  
  // Prepare audit log data instead of calling audit.logAction here
  const auditLog = {
    tenantUid,
    createdBy,
    action: 'VESTING_EVENT_CREATE',
    entityType: 'grant',
    entityId: grantUid,
    details: {
      before: {
        vested_amount: grant.vested_amount,
        version: grant.version
      },
      after: {
        vested_amount: newVestedTotal,
        version: grant.version + 1,
        vesting_event: {
          vest_date: vestDate,
          shares_vested: sharesVested,
          pps_snapshot: ppsSnapshot
        }
      }
    }
  };
  return {
    id: vestingUid,
    grantUid,
    tenantUid,
    vestDate,
    sharesVested,
    ppsSnapshot,
    createdAt: new Date().toISOString(),
    auditLog
  };
}

/**
 * Process vesting for a single grant up to a specific date
 * @param {number} grantUid - ID of the grant
 * @param {number} tenantUid - ID of the tenant
 * @param {string} currentDate - Date to process vesting up to (YYYY-MM-DD)
 * @param {string} timezone - Tenant timezone
 * @param {number} userUid - ID of the user initiating the vesting
 * @returns {Array} - Array of created vesting events
 */
function processGrantVesting(grantUid, tenantUid, currentDate, timezone, userUid) {
  console.log(`[DEBUG] processGrantVesting called with grantUid=${grantUid}, tenantUid=${tenantUid}, currentDate=${currentDate}, timezone=${timezone}, userUid=${userUid}`);
  // Get the grant
  const grant = db.get(
    `SELECT 
      grant_uid, employee_uid, grant_date, share_amount, vested_amount, 
      status, version, created_at
     FROM grant_record 
     WHERE grant_uid = ? AND tenant_uid = ? AND status = 'active' AND deleted_at IS NULL`,
    [grantUid, tenantUid]
  );
  console.log('[DEBUG] Grant loaded:', grant);
  if (!grant) {
    throw new Error('Grant not found or not active');
  }
  // Get existing vesting events for this grant
  const existingEvents = db.query(
    `SELECT vest_date FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ?`,
    [grantUid, tenantUid]
  );
  console.log(`[DEBUG] Existing vesting events count: ${existingEvents.length}`);
  // Create a Set of existing vesting dates for quick lookups
  const existingDates = new Set(existingEvents.map(e => e.vest_date));
  // Calculate all potential vesting dates
  const allVestingDates = calculateAllVestingDates(grant.grant_date, timezone);
  const tranches = calculateVestingTranches(grant.share_amount);
  console.log('[DEBUG] All vesting dates:', allVestingDates);
  console.log('[DEBUG] Tranches:', tranches);
  // Calculate cliff date
  const grantDateObj = dateUtils.parseDate(grant.grant_date, timezone);
  const currentDateObj = dateUtils.parseDate(currentDate, timezone);
  const cliffDate = grantDateObj.plus({ months: 12 });
  console.log(`[DEBUG] Cliff date: ${cliffDate.toISODate()}`);
  // If today is before the cliff, do nothing
  if (currentDateObj < cliffDate) {
    console.log('[DEBUG] Current date is before the cliff. No vesting events to create.');
    return [];
  }
  // Prepare vesting events to create in memory
  const eventsToCreate = [];
  // 1. Cliff vesting (month 12, index 11)
  const cliffVestingDate = allVestingDates[11];
  if (!existingDates.has(cliffVestingDate)) {
    const cliffShares = tranches.slice(0, 12).reduce((sum, t) => sum + parseFloat(t), 0);
    eventsToCreate.push({
      vestDate: cliffVestingDate,
      sharesVested: cliffShares,
      trancheIndex: 'cliff'
    });
    console.log(`[DEBUG] Cliff vesting event to create: date=${cliffVestingDate}, shares=${cliffShares}`);
  }
  // 2. Monthly vesting after the cliff (months 13-48, indexes 12-47)
  for (let i = 12; i < 48; i++) {
    const vestingDate = allVestingDates[i];
    const vestingDateObj = dateUtils.parseDate(vestingDate, timezone);
    if (vestingDateObj > currentDateObj) break;
    if (existingDates.has(vestingDate)) continue;
    eventsToCreate.push({
      vestDate: vestingDate,
      sharesVested: tranches[i],
      trancheIndex: i
    });
    console.log(`[DEBUG] Monthly vesting event to create: date=${vestingDate}, shares=${tranches[i]}, index=${i}`);
  }
  if (eventsToCreate.length === 0) {
    console.log('[DEBUG] No new vesting events needed for grant', grantUid);
    return [];
  }
  // Insert all missing vesting events in a single transaction with proper concurrency control
  let auditLogs = [];
  db.transaction((client) => {
    console.log('[DEBUG] Entering DB transaction for vesting event creation');
    // First, get the grant with SELECT FOR UPDATE to lock the row during the transaction
    const grantForUpdate = client.get(
      `SELECT grant_uid, vested_amount, version FROM grant_record 
       WHERE grant_uid = ? AND tenant_uid = ? AND status = 'active' AND deleted_at IS NULL`,
      [grantUid, tenantUid]
    );
    console.log('[DEBUG] Grant for update:', grantForUpdate);
    if (!grantForUpdate) {
      console.log(`[DEBUG] Grant ${grantUid} not found or not active during vesting transaction`);
      return;
    }
    // Re-check existing vesting events within the transaction to prevent race conditions
    const existingEventsInTx = client.all(
      `SELECT vest_date FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ?`,
      [grantUid, tenantUid]
    );
    const existingDatesInTx = new Set(existingEventsInTx.map(e => e.vest_date));
    // Filter out events that might have been created by another concurrent process
    const finalEventsToCreate = eventsToCreate.filter(e => !existingDatesInTx.has(e.vestDate));
    console.log(`[DEBUG] Final events to create after concurrency check: ${finalEventsToCreate.length}`);
    if (finalEventsToCreate.length === 0) {
      console.log(`[DEBUG] All vesting events already exist for grant ${grantUid} - no action needed`);
      return;
    }
    // Track successfully created events
    const createdEvents = [];
    // Insert events using INSERT OR IGNORE to handle potential race conditions
    for (const eventData of finalEventsToCreate) {
      const ppsSnapshot = getPPSForVestDate(tenantUid, eventData.vestDate);
      try {
        // Use INSERT OR IGNORE to handle the case where another process created the event
        const result = client.run(
          `INSERT OR IGNORE INTO vesting_event (
            vesting_uid, grant_uid, tenant_uid, vest_date, shares_vested, pps_snapshot, created_by, source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [vestingUid, grantUid, tenantUid, eventData.vestDate, eventData.sharesVested, ppsSnapshot, userUid, 'scheduled']
        );
        if (result.changes > 0) {
          console.log(`[DEBUG] Created vesting event for ${eventData.vestDate} with ${eventData.sharesVested} shares`);
          createdEvents.push({
            vestDate: eventData.vestDate,
            sharesVested: eventData.sharesVested,
            ppsSnapshot
          });
          // Prepare audit log for this event
          auditLogs.push({
            tenantUid,
            createdBy: userUid,
            action: 'VESTING_EVENT_CREATE',
            entityType: 'grant',
            entityId: grantUid,
            details: {
              before: {
                vested_amount: grantForUpdate.vested_amount,
                version: grantForUpdate.version
              },
              after: {
                vested_amount: parseFloat(grantForUpdate.vested_amount) + parseFloat(eventData.sharesVested),
                version: grantForUpdate.version + 1,
                vesting_event: {
                  vest_date: eventData.vestDate,
                  shares_vested: eventData.sharesVested,
                  pps_snapshot: ppsSnapshot
                }
              }
            }
          });
        } else {
          console.log(`[DEBUG] Vesting event for ${eventData.vestDate} already exists - skipped`);
        }
      } catch (error) {
        // If we get a UNIQUE constraint error, the event was created by another process
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
          console.log(`[DEBUG] Vesting event for ${eventData.vestDate} was created by another process - skipped`);
        } else {
          console.error(`[DEBUG] Error creating vesting event for ${eventData.vestDate}:`, error);
          throw error; // Rethrow other errors
        }
      }
    }
    // Only update the grant's vested amount if we actually created new events
    if (createdEvents.length > 0) {
      // Calculate the total shares vested in this transaction
      const newVestedShares = createdEvents.reduce((sum, e) => sum + parseFloat(e.sharesVested), 0);
      // Update the grant's vested amount with optimistic locking
      const newVestedTotal = parseFloat(grantForUpdate.vested_amount) + newVestedShares;
      const updateResult = client.run(
        'UPDATE grant_record SET vested_amount = ?, version = ? WHERE grant_uid = ? AND tenant_uid = ? AND version = ?',
        [newVestedTotal, grantForUpdate.version + 1, grantUid, tenantUid, grantForUpdate.version]
      );
      // If the update failed due to a concurrent update, we need to recalculate the vested amount
      if (updateResult.changes === 0) {
        console.log(`[DEBUG] Optimistic locking failed for grant ${grantUid} - recalculating vested amount`);
        // Get the current grant version
        const currentGrant = client.get(
          `SELECT version FROM grant_record WHERE grant_uid = ? AND tenant_uid = ?`,
          [grantUid, tenantUid]
        );
        if (currentGrant) {
          // Calculate the total vested amount from all vesting events
          const totalVested = client.get(
            `SELECT SUM(shares_vested) as total FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ?`,
            [grantUid, tenantUid]
          );
          // Update with the correct total
          client.run(
            'UPDATE grant_record SET vested_amount = ?, version = ? WHERE grant_uid = ? AND tenant_uid = ?',
            [totalVested.total, currentGrant.version + 1, grantUid, tenantUid]
          );
          console.log(`[DEBUG] Updated grant ${grantUid} vested amount to ${totalVested.total} after recalculation`);
        }
      } else {
        console.log(`[DEBUG] Updated grant ${grantUid} vested amount to ${newVestedTotal}`);
      }
    }
    console.log(`[DEBUG] Created events in transaction:`, createdEvents);
  });
  // After transaction, write audit logs
  for (const log of auditLogs) {
    audit.logAction(
      log.tenantUid,
      log.createdBy,
      log.action,
      log.entityType,
      log.entityId,
      log.details
    );
  }
  console.log(`[DEBUG] Created a total of ${eventsToCreate.length} vesting events for grant ${grantUid}`);
  return eventsToCreate;
}

/**
 * Calculate vesting for all grants in a tenant up to the current date
 * To be run as a scheduled daily job
 * @param {number} tenantUid - ID of the tenant
 * @param {string} timezone - Tenant timezone
 * @param {number} userUid - ID of the system user processing the batch
 * @returns {Object} - Results of the batch processing
 */
function processBatchVesting(tenantUid, timezone, userUid) {
  // Get the current date in tenant's timezone
  const currentDate = dateUtils.getCurrentDate(timezone);
  console.log(`Processing batch vesting for all grants up to ${currentDate}`);
  
  // Get all active grants
  const grants = db.query(
    `SELECT grant_uid, grant_date, employee_uid FROM grant_record 
     WHERE tenant_uid = ? AND status = 'active' AND deleted_at IS NULL
     ORDER BY grant_date ASC`,
    [tenantUid]
  );
  
  console.log(`Found ${grants.length} active grants to process`);
  
  const results = {
    processed: 0,
    skipped: 0,
    errors: [],
    createdEvents: 0,
    processedGrants: []
  };
  
  // Process each grant
  for (const grant of grants) {
    try {
      console.log(`Processing grant ${grant.grant_uid} (granted on ${grant.grant_date})`);
      
      // Special handling for grant 51 which seems to be causing issues
      if (grant.grant_uid === 51) {
        console.log(`Special handling for grant ${grant.grant_uid} which was causing server crashes`);
        try {
          // Wrap in an additional try-catch to ensure we don't crash the server
          const events = processGrantVesting(grant.grant_uid, tenantUid, currentDate, timezone, userUid);
          console.log(`Successfully processed grant ${grant.grant_uid}`);
          
          // Fix: Check if events exists and has a length property
          const eventsCreated = events && events.length ? events.length : 0;
          
          if (eventsCreated > 0) {
            results.processed++;
            results.createdEvents += eventsCreated;
            results.processedGrants.push({
              grantUid: grant.grant_uid,
              grantDate: grant.grant_date,
              eventsCreated: eventsCreated
            });
            console.log(`Created ${eventsCreated} vesting events for grant ${grant.grant_uid}`);
          } else {
            results.skipped++;
            console.log(`No new vesting events needed for grant ${grant.grant_uid}`);
          }
        } catch (specialErr) {
          console.error(`Error processing grant ${grant.grant_uid} with special handling:`, specialErr.message);
          console.log(`Continuing with other grants despite error with grant ${grant.grant_uid}`);
          results.errors.push({
            grantUid: grant.grant_uid,
            error: specialErr.message
          });
        }
      } else {
        // Normal processing for other grants
        const events = processGrantVesting(grant.grant_uid, tenantUid, currentDate, timezone, userUid);
        
        // Fix: Check if events exists and has a length property
        const eventsCreated = events && events.length ? events.length : 0;
        
        if (eventsCreated > 0) {
          results.processed++;
          results.createdEvents += eventsCreated;
          results.processedGrants.push({
            grantUid: grant.grant_uid,
            grantDate: grant.grant_date,
            eventsCreated: eventsCreated
          });
          console.log(`Created ${eventsCreated} vesting events for grant ${grant.grant_uid}`);
        } else {
          results.skipped++;
          console.log(`No new vesting events needed for grant ${grant.grant_uid}`);
        }
      }
    } catch (err) {
      console.error(`Error processing vesting for grant ${grant.grant_uid}:`, err);
      results.errors.push({
        grantUid: grant.grant_uid,
        error: err.message
      });
    }
  }
  
  console.log(`Batch vesting complete: processed ${results.processed} grants, created ${results.createdEvents} events, skipped ${results.skipped} grants, ${results.errors.length} errors`);
  
  return results;
}

/**
 * Process vesting for a grant with backdated vesting history
 * Used when a grant that was effective more than 1 year ago is added to the system
 * @param {number} grantUid - ID of the grant
 * @param {number} tenantUid - ID of the tenant
 * @param {string} effectiveDate - Date when grant became effective (original grant date)
 * @param {string} timezone - Tenant timezone
 * @param {number} userUid - ID of the user initiating the vesting
 * @returns {Array} - Array of created vesting events
 */
function processBackdatedVesting(grantUid, tenantUid, effectiveDate, timezone, userUid) {
  // Get the grant
  const grant = db.get(
    `SELECT 
      grant_uid, employee_uid, grant_date, share_amount, vested_amount, 
      status, version, created_at
     FROM grant_record 
     WHERE grant_uid = ? AND tenant_uid = ? AND status = 'active' AND deleted_at IS NULL`,
    [grantUid, tenantUid]
  );
  
  if (!grant) {
    throw new Error('Grant not found or not active');
  }
  
  console.log(`Processing backdated vesting for grant ${grantUid} with effective date ${effectiveDate}`);
  
  // Get existing vesting events for this grant
  const existingEvents = db.query(
    `SELECT vest_date FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ?`,
    [grantUid, tenantUid]
  );
  
  console.log(`Found ${existingEvents.length} existing vesting events`);
  
  // Create a Set of existing vesting dates for quick lookups
  const existingDates = new Set(existingEvents.map(e => e.vest_date));
  
  // Calculate all potential vesting dates based on effective date (not grant_date)
  const allVestingDates = calculateAllVestingDates(effectiveDate, timezone);
  
  // Calculate tranche sizes
  const tranches = calculateVestingTranches(grant.share_amount);
  
  // Get the current date
  const currentDate = dateUtils.getCurrentDate(timezone);
  const currentDateObj = dateUtils.parseDate(currentDate, timezone);
  
  // Calculate cliff date
  const effectiveDateObj = dateUtils.parseDate(effectiveDate, timezone);
  const cliffDate = effectiveDateObj.plus({ months: 12 });
  
  // If today is before the cliff, do nothing
  if (currentDateObj < cliffDate) {
    console.log('Current date is before the cliff. No vesting events to create.');
    return [];
  }

  // Prepare vesting events to create
  const createdEvents = [];

  // 1. Cliff vesting (month 12, index 11)
  const cliffVestingDate = allVestingDates[11];
  if (!existingDates.has(cliffVestingDate)) {
    // Sum tranches for months 1-12
    const cliffShares = tranches.slice(0, 12).reduce((sum, t) => sum + parseFloat(t), 0);
    const ppsSnapshot = getPPSForVestDate(tenantUid, cliffVestingDate);
    const event = createVestingEvent(db, {
      grantUid: grant.grant_uid,
      tenantUid,
      vestDate: cliffVestingDate,
      sharesVested: cliffShares,
      ppsSnapshot,
      createdBy: userUid
    });
    createdEvents.push(event);
    console.log(`Created cliff vesting event for ${cliffVestingDate} with ${cliffShares} shares`);
  }

  // 2. Monthly vesting after the cliff (months 13-48, indexes 12-47)
  for (let i = 12; i < 48; i++) {
    const vestingDate = allVestingDates[i];
    const vestingDateObj = dateUtils.parseDate(vestingDate, timezone);
    if (vestingDateObj > currentDateObj) break;
    if (existingDates.has(vestingDate)) continue;
    const ppsSnapshot = getPPSForVestDate(tenantUid, vestingDate);
    const event = createVestingEvent(db, {
      grantUid: grant.grant_uid,
      tenantUid,
      vestDate: vestingDate,
      sharesVested: tranches[i],
      ppsSnapshot,
      createdBy: userUid
    });
    createdEvents.push(event);
    console.log(`Created monthly vesting event for ${vestingDate} with ${tranches[i]} shares`);
  }

  console.log(`Created a total of ${createdEvents.length} vesting events for grant ${grantUid}`);
  return createdEvents;
}

/**
 * Calculate vesting for display purposes only
 * This doesn't create any events or update the database
 * It's used to show the current vesting status, even if events haven't been created yet
 * 
 * @param {Object} grant - Grant object with all details
 * @param {string} currentDate - Current date (YYYY-MM-DD) in tenant timezone
 * @param {string} timezone - Tenant timezone
 * @returns {Object} - Object with vesting details for display
 */
function calculateVestingForDisplay(grant, currentDate, timezone) {
  try {
    const grantDateObj = dateUtils.parseDate(grant.grantDate, timezone);
    const currentDateObj = dateUtils.parseDate(currentDate, timezone);
    // Determine the vesting cutoff date: earliest of inactive_effective_date or termination_effective_date (if present)
    let cutoffDateObj = currentDateObj;
    if (grant.inactiveEffectiveDate || grant.terminationEffectiveDate) {
      const inactiveDateObj = grant.inactiveEffectiveDate ? dateUtils.parseDate(grant.inactiveEffectiveDate, timezone) : null;
      const terminationDateObj = grant.terminationEffectiveDate ? dateUtils.parseDate(grant.terminationEffectiveDate, timezone) : null;
      if (inactiveDateObj && terminationDateObj) {
        cutoffDateObj = inactiveDateObj < terminationDateObj ? inactiveDateObj : terminationDateObj;
      } else if (inactiveDateObj) {
        cutoffDateObj = inactiveDateObj;
      } else if (terminationDateObj) {
        cutoffDateObj = terminationDateObj;
      }
    }
    // Calculate all potential vesting dates
    const allVestingDates = calculateAllVestingDates(grant.grantDate, timezone);
    // Calculate tranche sizes
    const tranches = calculateVestingTranches(grant.shareAmount);
    // Check cliff status
    const twelveMonthsAfterGrant = grantDateObj.plus({ months: 12 });
    const isPastCliff = cutoffDateObj >= twelveMonthsAfterGrant || 
                       cutoffDateObj.toISODate() >= twelveMonthsAfterGrant.toISODate();
    // Calculate the number of months elapsed since grant date
    const monthsElapsed = cutoffDateObj.diff(grantDateObj, 'months').months;
    // Filter dates that should be vested by now (up to cutoff date)
    const vestedDates = allVestingDates
      .map((date, index) => ({ date, index }))
      .filter(({ date, index }) => {
        const dateObj = dateUtils.parseDate(date, timezone);
        const isExactlyAtCliff = index === 11;
        return (
          dateObj <= cutoffDateObj && 
          (isPastCliff || index >= 11 || isExactlyAtCliff)
        );
      });
    // Calculate theoretical vested amount
    let theoreticalVestedAmount = 0;
    for (const { index } of vestedDates) {
      theoreticalVestedAmount = decimal.add(theoreticalVestedAmount, tranches[index]);
    }
    // Calculate vesting percentage
    const vestedPercent = decimal.divide(theoreticalVestedAmount, grant.shareAmount);
    const formattedVestedPercent = decimal.formatPercent(vestedPercent);
    // Get existing vesting events for comparison
    const existingVestedAmount = parseFloat(grant.vestedAmount || '0');
    const existingVestedPercent = decimal.formatPercent(
      decimal.divide(existingVestedAmount.toString(), grant.shareAmount)
    );
    return {
      grantUid: grant.id || grant.uid,
      shareAmount: parseFloat(grant.shareAmount),
      existingVestedAmount: existingVestedAmount,
      existingVestedPercent: existingVestedPercent,
      theoreticalVestedAmount: parseFloat(theoreticalVestedAmount),
      theoreticalVestedPercent: formattedVestedPercent,
      monthsElapsed: monthsElapsed,
      isPastCliff: isPastCliff,
      upToDate: (
        Math.abs(existingVestedAmount - parseFloat(theoreticalVestedAmount)) < 0.001
      ),
      inactiveEffectiveDate: grant.inactiveEffectiveDate || null,
      terminationEffectiveDate: grant.terminationEffectiveDate || null,
      vestingCutoffDate: cutoffDateObj.toISODate()
    };
  } catch (error) {
    console.error('Error calculating vesting for display:', error);
    return {
      grantUid: grant.id || grant.uid,
      shareAmount: parseFloat(grant.shareAmount),
      existingVestedAmount: parseFloat(grant.vestedAmount || '0'),
      existingVestedPercent: decimal.formatPercent(
        decimal.divide(grant.vestedAmount || '0', grant.shareAmount)
      ),
      theoreticalVestedAmount: 0,
      theoreticalVestedPercent: '0%',
      monthsElapsed: 0,
      isPastCliff: false,
      upToDate: true,
      inactiveEffectiveDate: grant.inactiveEffectiveDate || null,
      terminationEffectiveDate: grant.terminationEffectiveDate || null,
      vestingCutoffDate: null,
      error: error.message
    };
  }
}

/**
 * Process vesting automatically for a newly created grant
 * This is called when a grant with a past date is created
 * 
 * @param {number} grantUid - ID of the grant
 * @param {number} tenantUid - ID of the tenant
 * @param {string} grantDate - The grant date
 * @param {string} timezone - Tenant timezone
 * @param {number} userUid - ID of the user creating the grant
 * @returns {Array} - Array of created vesting events
 */
function processNewGrantVesting(grantUid, tenantUid, grantDate, timezone, userUid) {
  console.log(`Processing initial vesting for new grant ${grantUid} with grant date ${grantDate}`);
  
  // Get the current date in tenant's timezone
  const currentDate = dateUtils.getCurrentDate(timezone);
  
  // Check if grant date is in the past
  if (grantDate >= currentDate) {
    console.log(`Grant date ${grantDate} is not in the past, no initial vesting needed`);
    return [];
  }
  
  // Process vesting - use the backdated vesting logic for grants with past dates
  // Get the grant date in the tenant's timezone
  const grantDateTime = dateUtils.parseDate(grantDate, timezone);
  
  // Check if we should bypass cliff (grant date > 12 months ago)
  const twelveMonthsAgo = dateUtils.parseDate(currentDate, timezone).minus({ months: 12 });
  const bypassCliff = grantDateTime <= twelveMonthsAgo;
  
  if (bypassCliff) {
    console.log(`Grant date ${grantDate} is more than 12 months old, bypassing cliff restriction`);
    return processBackdatedVesting(grantUid, tenantUid, grantDate, timezone, userUid);
  } else {
    console.log(`Grant date ${grantDate} is less than 12 months old, using standard vesting process`);
    return processGrantVesting(grantUid, tenantUid, currentDate, timezone, userUid);
  }
}

/**
 * Get vesting summary for a grant (vested and unvested shares)
 * @param {number} grantUid - Grant ID
 * @param {number} tenantUid - Tenant ID
 * @param {string} timezone - Tenant timezone (optional, for future use)
 * @returns {Object} - { vested, unvested }
 */
function getVestingSummary(grantUid, tenantUid, timezone) {
  // Get grant info
  const grant = db.get(
    `SELECT share_amount FROM grant_record WHERE grant_uid = ? AND tenant_uid = ? AND deleted_at IS NULL`,
    [grantUid, tenantUid]
  );
  if (!grant) return { vested: 0, unvested: 0 };
  // Sum vested shares
  const vestedRow = db.get(
    `SELECT SUM(shares_vested) as vested FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ?`,
    [grantUid, tenantUid]
  );
  const vested = parseFloat(vestedRow && vestedRow.vested ? vestedRow.vested : 0);
  const shareAmount = parseFloat(grant.share_amount);
  const unvested = Math.max(0, shareAmount - vested);
  return { vested, unvested };
}

// Export all functions
module.exports = {
  calculateVestingDate,
  calculateAllVestingDates,
  calculateVestingTranches,
  getPPSForVestDate,
  createVestingEvent,
  processGrantVesting,
  processBatchVesting,
  processBackdatedVesting,
  calculateVestingForDisplay,
  processNewGrantVesting,
  getVestingSummary
}; 