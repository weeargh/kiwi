/**
 * Scheduled Vesting Job
 * 
 * This job automatically processes vesting for all active grants across all tenants.
 * It's scheduled to run daily, ensuring all vesting is up-to-date even if users don't
 * regularly visit the website.
 */

const db = require('../db');
const vestingService = require('../services/vesting');
const dateUtils = require('../utils/date');

// System user for automated tasks (UID for system)
const SYSTEM_USER_UID = 'system-automation-uid'; // Replace with actual system user UID if available

/**
 * Process vesting for all tenants
 * Iterates through each tenant and processes all active grants
 */
async function processAllTenantsVesting() {
  console.log('Starting scheduled vesting job');
  
  try {
    // Get all active tenants
    const tenants = await db.query('SELECT tenant_uid, timezone FROM tenant WHERE deleted_at IS NULL');
    console.log(`Found ${tenants.length} active tenants`);
    
    let totalProcessed = 0;
    let totalEvents = 0;
    let errors = 0;
    
    // Process vesting for each tenant
    for (const tenant of tenants) {
      try {
        const tenantUid = tenant.tenant_uid;
        const timezone = tenant.timezone || 'UTC';
        
        console.log(`Processing vesting for tenant ${tenantUid} (timezone: ${timezone})`);
        
        // Get current date in tenant's timezone
        const currentDate = dateUtils.getCurrentDate(timezone);
        console.log(`Tenant current date: ${currentDate}`);
        
        // Process batch vesting for this tenant
        const results = await vestingService.processBatchVesting(tenantUid, timezone, SYSTEM_USER_UID);
        
        // Add to totals
        totalProcessed += results.processed;
        totalEvents += results.createdEvents;
        errors += results.errors.length;
        
        console.log(`Tenant ${tenantUid} results: ${results.processed} grants processed, ${results.createdEvents} events created`);
      } catch (err) {
        console.error(`Error processing tenant ${tenant.tenant_uid}:`, err);
        errors++;
      }
    }
    
    console.log('====== VESTING JOB COMPLETE ======');
    console.log(`Processed ${totalProcessed} grants`);
    console.log(`Created ${totalEvents} vesting events`);
    console.log(`Encountered ${errors} errors`);
    
    return {
      success: true,
      processed: totalProcessed,
      events: totalEvents,
      errors: errors
    };
  } catch (err) {
    console.error('Fatal error in scheduled vesting job:', err);
    
    return {
      success: false,
      error: err.message
    };
  }
}

// If running directly as a script
if (require.main === module) {
  processAllTenantsVesting()
    .then(result => {
      console.log('Job completed with result:', result);
      process.exit(0);
    })
    .catch(err => {
      console.error('Job failed:', err);
      process.exit(1);
    });
}

module.exports = {
  processAllTenantsVesting
}; 