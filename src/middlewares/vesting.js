/**
 * Automatic Vesting Middleware
 * 
 * This middleware ensures vesting is calculated automatically as needed.
 * It runs for specific routes that display grant or vesting information.
 */

const dateUtils = require('../utils/date');
const vestingService = require('../services/vesting');

/**
 * Middleware that automatically processes vesting for all grants
 * This is a background process that runs when accessing specific pages
 * It doesn't block the main request and handles failures gracefully
 */
function autoProcessVesting(req, res, next) {
  // Only run for authenticated users
  if (!req.session || !req.session.user || !req.tenantUid) {
    return next();
  }
  
  // Paths that should trigger automatic vesting calculation
  const autoVestingPaths = [
    '/grants',
    '/vesting',
    '/employees'
  ];
  
  // Check if the current path should trigger vesting
  const shouldProcessVesting = autoVestingPaths.some(path => 
    req.path === path || req.path.startsWith(`${path}/`)
  );
  
  if (shouldProcessVesting) {
    const tenantUid = req.tenantUid;
    const userUid = req.session.user.user_uid;
    const timezone = req.session.user.timezone || 'UTC';
    
    // Get current date in tenant timezone
    const currentDate = dateUtils.getCurrentDate(timezone);
    
    // Process batch vesting in the background
    // Use setTimeout to avoid blocking the request
    setTimeout(async () => {
      try {
        console.log('[AUTO-VESTING] Middleware: Processing vesting for all active grants');
        
        // First check if another vesting process is already running for this tenant
        const db = require('../db');
        const processingLockKey = `tenant_${tenantUid}_vesting_lock`;
        
        // Try to acquire a lock using the vesting_processing_status table
        // First, get a valid grant_uid to use for the lock (the table has a foreign key constraint)
        const validGrant = await db.get(
          `SELECT grant_uid FROM grant_record WHERE tenant_uid = ? AND status = 'active' LIMIT 1`,
          [tenantUid]
        );
        
        if (!validGrant) {
          console.log(`[AUTO-VESTING] No active grants found for tenant ${tenantUid}, skipping vesting`);
          return;
        }
        
        const lockResult = await db.run(
          `INSERT OR IGNORE INTO vesting_processing_status 
           (grant_uid, tenant_uid, last_processed_date, status, message, created_by) 
           VALUES (?, ?, ?, 'running', 'Auto-vesting middleware lock', ?)`,
          [validGrant.grant_uid, tenantUid, currentDate, userUid]
        );
        
        // If another process is already running, skip this one
        if (lockResult.changes === 0) {
          console.log(`[AUTO-VESTING] Another vesting process is already running for tenant ${tenantUid}, skipping`);
          return;
        }
        
        // Get the lock ID for cleanup later
        const lock = await db.get(
          `SELECT id FROM vesting_processing_status 
           WHERE grant_uid = ? AND tenant_uid = ? AND status = 'running' 
           ORDER BY created_at DESC LIMIT 1`,
          [validGrant.grant_uid, tenantUid]
        );
        
        const lockId = lock ? lock.id : null;
        
        try {
          // First check for any grants past cliff with missing vesting events
          const activeGrants = await db.query(
            `SELECT g.grant_uid, g.grant_date, g.share_amount,
                    (SELECT COUNT(*) FROM vesting_event v WHERE v.grant_uid = g.grant_uid AND v.tenant_uid = g.tenant_uid) as event_count
             FROM grant_record g
             WHERE g.tenant_uid = ? AND g.status = 'active' AND g.deleted_at IS NULL
             ORDER BY g.grant_date ASC`,
            [tenantUid]
          );
          
          console.log(`[AUTO-VESTING] Middleware found ${activeGrants.length} active grants to check`);
          
          // Process any grants that should have vesting events but don't
          let priorityGrantsProcessed = 0;
          let priorityEventsCreated = 0;
          
          for (const grant of activeGrants) {
            try {
              const grantDateObj = dateUtils.parseDate(grant.grant_date, timezone);
              const currentDateObj = dateUtils.parseDate(currentDate, timezone);
              const twelveMonthsAfterGrant = grantDateObj.plus({ months: 12 });
              const isPastCliff = currentDateObj >= twelveMonthsAfterGrant || 
                                currentDateObj.toISODate() >= twelveMonthsAfterGrant.toISODate();
              
              const monthsElapsed = currentDateObj.diff(grantDateObj, 'months').months;
              const expectedEvents = isPastCliff ? Math.floor(monthsElapsed - 11) : 0;
              
              // If past cliff and missing events, prioritize this grant for processing
              if (isPastCliff && grant.event_count < expectedEvents) {
                console.log(`[AUTO-VESTING] Priority vesting for grant ${grant.grant_uid}: ${grant.event_count} events, expecting ~${expectedEvents}`);
                
                // Process this grant individually
                const events = await vestingService.processGrantVesting(
                  grant.grant_uid,
                  tenantUid,
                  currentDate,
                  timezone,
                  userUid
                );
                
                const eventsCreated = events && Array.isArray(events) ? events.length : 0;
                if (eventsCreated > 0) {
                  priorityGrantsProcessed++;
                  priorityEventsCreated += eventsCreated;
                }
                
                console.log(`[AUTO-VESTING] Middleware created ${eventsCreated} vesting events for grant ${grant.grant_uid}`);
              }
            } catch (grantErr) {
              console.error(`[AUTO-VESTING] Error processing individual grant ${grant.grant_uid}:`, grantErr);
            }
          }
          
          // Only run batch processing if we haven't already processed all grants individually
          if (priorityGrantsProcessed < activeGrants.length) {
            console.log(`[AUTO-VESTING] Running batch processing for remaining grants`);
            // Continue with normal batch processing for all grants
            const results = await vestingService.processBatchVesting(tenantUid, timezone, userUid);
            console.log(`[AUTO-VESTING] Complete: processed ${priorityGrantsProcessed + results.processed} grants, created ${priorityEventsCreated + results.createdEvents} events`);
          } else {
            console.log(`[AUTO-VESTING] Complete: processed ${priorityGrantsProcessed} grants via priority processing, created ${priorityEventsCreated} events`);
          }
        } finally {
          // Release the lock
          if (lockId) {
            await db.run(
              `UPDATE vesting_processing_status SET status = 'complete', message = 'Auto-vesting middleware completed', updated_at = datetime('now') 
               WHERE id = ?`,
              [lockId]
            );
            console.log(`[AUTO-VESTING] Released processing lock for tenant ${tenantUid}`);
          }
        }
      } catch (err) {
        console.error('[AUTO-VESTING] Error in automatic vesting middleware:', err);
      }
    }, 10);
  }
  
  // Always continue to the next middleware
  next();
}

module.exports = {
  autoProcessVesting
}; 