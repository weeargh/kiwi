/**
 * Fix Vesting Script
 * 
 * This script checks all grants in the system and processes vesting for any grants
 * that have incorrect vesting calculations. It uses the processBackdatedVesting function,
 * which is more robust for handling past-dated grants.
 * 
 * This is especially useful for fixing grants that were created before the automatic
 * backdated vesting calculation was implemented in the grant creation process.
 */

const vestingService = require('./src/services/vesting');
const db = require('./src/db');
const dateUtils = require('./src/utils/date');
const { DateTime } = require('luxon');

async function processGrant(grant, tenantId) {
  try {
    console.log(`\nProcessing grant ${grant.id} with date ${grant.grant_date}`);
    
    // Get information about this grant
    const shareAmount = parseFloat(grant.share_amount);
    const vestedAmount = parseFloat(grant.vested_amount);
    
    // Get existing vesting events
    const existingEvents = await db.query(
      `SELECT vest_date FROM vesting_event WHERE grant_id = ? AND tenant_id = ?`,
      [grant.id, tenantId]
    );
    
    console.log(`Found ${existingEvents.length} existing vesting events`);
    
    // Calculate expected vesting
    const grantDate = grant.grant_date;
    const grantDateObj = DateTime.fromISO(grantDate);
    const currentDate = new Date().toISOString().split('T')[0];
    const currentDateObj = DateTime.fromISO(currentDate);
    
    // Calculate months elapsed since grant date
    const monthsElapsed = currentDateObj.diff(grantDateObj, 'months').months;
    console.log(`Months elapsed since grant: ${monthsElapsed.toFixed(1)}`);
    
    // Calculate if cliff has passed
    const isPastCliff = monthsElapsed >= 12;
    console.log(`Past cliff period: ${isPastCliff}`);
    
    // Calculate expected vested percentage
    let expectedPercentage = 0;
    if (isPastCliff) {
      // If past cliff, calculate monthly percentage (1/48 per month, respecting cliff)
      const vestedMonths = Math.min(48, Math.floor(monthsElapsed));
      const effectiveMonths = Math.max(0, vestedMonths - 12) + (vestedMonths >= 12 ? 12 : 0);
      expectedPercentage = effectiveMonths / 48;
    }
    
    const expectedVestedAmount = shareAmount * expectedPercentage;
    console.log(`Share amount: ${shareAmount}, Expected vested: ${expectedVestedAmount.toFixed(3)} (${(expectedPercentage * 100).toFixed(1)}%)`);
    console.log(`Current vested amount: ${vestedAmount} (${((vestedAmount / shareAmount) * 100).toFixed(1)}%)`);
    
    // Determine if this grant needs fixing
    const needsFix = Math.abs(expectedVestedAmount - vestedAmount) > 0.001;
    if (!needsFix) {
      console.log(`Grant ${grant.id} has correct vesting amounts.`);
      return {
        grantId: grant.id,
        fixed: false,
        reason: 'Vesting is already correct'
      };
    }
    
    // If there's a significant discrepancy, process backdated vesting
    console.log(`\nFIXING GRANT ${grant.id} - Incorrect vesting detected`);
    
    // Process backdated vesting
    const events = await vestingService.processBackdatedVesting(
      grant.id,
      tenantId,
      grant.grant_date, // Use the grant's original date
      'UTC', // Default timezone
      1 // Admin user
    );
    
    console.log(`Fixed grant ${grant.id} by creating ${events.length} vesting events`);
    
    return {
      grantId: grant.id,
      fixed: true,
      eventsCreated: events.length
    };
  } catch (error) {
    console.error(`Error processing grant ${grant.id}:`, error.message);
    return {
      grantId: grant.id,
      fixed: false,
      error: error.message
    };
  }
}

async function processAllGrants() {
  try {
    console.log('Connecting to database...');
    
    // Get all active grants
    const tenants = await db.query(`SELECT DISTINCT tenant_id FROM tenant`);
    console.log(`Found ${tenants.length} tenants`);
    
    const results = {
      processed: 0,
      fixed: 0,
      errors: [],
      unchanged: 0
    };
    
    // Process each tenant
    for (const tenant of tenants) {
      const tenantId = tenant.tenant_id;
      console.log(`\nProcessing tenant ${tenantId}`);
      
      // Get all grants for this tenant
      const grants = await db.query(
        `SELECT grant_id, grant_date, share_amount, vested_amount
         FROM grant_record 
         WHERE tenant_id = ? AND status = 'active' AND deleted_at IS NULL
         ORDER BY grant_date ASC`,
        [tenantId]
      );
      
      console.log(`Found ${grants.length} active grants for tenant ${tenantId}`);
      
      // Process each grant
      for (const grant of grants) {
        results.processed++;
        const grantResult = await processGrant(grant, tenantId);
        
        if (grantResult.fixed) {
          results.fixed++;
        } else if (grantResult.error) {
          results.errors.push(grantResult);
        } else {
          results.unchanged++;
        }
      }
    }
    
    // Print summary
    console.log("\n==== SUMMARY ====");
    console.log(`Processed ${results.processed} grants`);
    console.log(`Fixed ${results.fixed} grants with incorrect vesting`);
    console.log(`Left ${results.unchanged} grants unchanged (correct vesting)`);
    console.log(`Encountered ${results.errors.length} errors`);
    
    if (results.errors.length > 0) {
      console.log("\nErrors encountered:");
      results.errors.forEach(err => {
        console.log(`- Grant ${err.grantId}: ${err.error}`);
      });
    }
    
    console.log('\nDone!');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

// Run the script
processAllGrants(); 