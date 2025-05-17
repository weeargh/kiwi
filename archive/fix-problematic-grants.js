/**
 * Script to fix problematic grants that are causing server crashes
 * This script will:
 * 1. Identify grants that might be causing issues
 * 2. Fix any data inconsistencies
 * 3. Ensure proper vesting events are created
 */

const db = require('./src/db');
const { DateTime } = require('luxon');

// Configuration
const TENANT_ID = 1;
const USER_ID = 1;
const TIMEZONE = 'America/Los_Angeles';
const CURRENT_DATE = DateTime.now().toISODate();

async function fixProblematicGrants() {
  console.log('===== FIXING PROBLEMATIC GRANTS =====');
  
  try {
    console.log('\n1. Identifying problematic grants...');
    
    // Get grant 51 which is causing issues
    const grant51 = await db.get(
      'SELECT * FROM grant_record WHERE grant_id = 51'
    );
    
    if (!grant51) {
      console.log('   Grant 51 not found, skipping...');
    } else {
      console.log(`   Found grant 51: ${JSON.stringify(grant51)}`);
      
      // Check if there are any vesting events for this grant
      const vestingEvents = await db.query(
        'SELECT * FROM vesting_event WHERE grant_id = 51'
      );
      
      console.log(`   Grant 51 has ${vestingEvents.length} vesting events`);
      
      // Fix 1: Make sure the grant has proper vesting events
      if (vestingEvents.length === 0) {
        console.log('\n2. Creating proper vesting events for grant 51...');
        
        // Calculate vesting dates based on grant date
        const grantDate = DateTime.fromISO(grant51.grant_date);
        const cliffDate = grantDate.plus({ months: 12 });
        const currentDateTime = DateTime.fromISO(CURRENT_DATE);
        
        // Only create vesting events if past cliff
        if (currentDateTime >= cliffDate) {
          console.log(`   Grant date: ${grantDate.toISODate()}, Cliff date: ${cliffDate.toISODate()}`);
          console.log(`   Current date: ${CURRENT_DATE} is past cliff, creating vesting events`);
          
          // Calculate months since grant date
          const monthsSinceGrant = Math.floor(currentDateTime.diff(grantDate, 'months').months);
          const monthsToVest = Math.min(monthsSinceGrant - 11, 48); // Max 48 months total vesting
          
          console.log(`   Months since grant: ${monthsSinceGrant}, Months to vest: ${monthsToVest}`);
          
          // Calculate shares per month (4-year monthly vesting = 1/48 per month)
          const totalShares = parseFloat(grant51.share_amount);
          const sharesPerMonth = totalShares / 48;
          
          // Create vesting events
          let totalVested = 0;
          const eventsCreated = [];
          
          for (let i = 1; i <= monthsToVest; i++) {
            const vestDate = cliffDate.plus({ months: i - 1 }).toISODate();
            let sharesToVest = sharesPerMonth;
            
            // For first month after cliff, vest 25% (12 months worth)
            if (i === 1) {
              sharesToVest = totalShares * 0.25;
            }
            
            // Round to 3 decimal places
            sharesToVest = Math.round(sharesToVest * 1000) / 1000;
            totalVested += sharesToVest;
            
            try {
              // Use INSERT OR IGNORE to handle potential duplicates
              const result = await db.run(
                `INSERT OR IGNORE INTO vesting_event (
                  grant_id, tenant_id, vest_date, shares_vested, created_by
                ) VALUES (?, ?, ?, ?, ?)`,
                [51, TENANT_ID, vestDate, sharesToVest, USER_ID]
              );
              
              if (result.changes > 0) {
                console.log(`   Created vesting event for ${vestDate} with ${sharesToVest} shares`);
                eventsCreated.push({ vestDate, sharesToVest });
              } else {
                console.log(`   Vesting event for ${vestDate} already exists, skipped`);
              }
            } catch (error) {
              console.error(`   Error creating vesting event for ${vestDate}:`, error.message);
            }
          }
          
          console.log(`   Created ${eventsCreated.length} vesting events for grant 51`);
          
          // Fix 2: Update the vested_amount in the grant record
          if (eventsCreated.length > 0) {
            // Calculate total vested amount from all vesting events
            const vestedResult = await db.get(
              'SELECT SUM(shares_vested) as total FROM vesting_event WHERE grant_id = 51'
            );
            
            const totalVestedAmount = vestedResult.total || 0;
            
            // Update the grant record
            await db.run(
              'UPDATE grant_record SET vested_amount = ?, version = version + 1 WHERE grant_id = 51',
              [totalVestedAmount]
            );
            
            console.log(`   Updated grant 51 vested_amount to ${totalVestedAmount}`);
          }
        } else {
          console.log(`   Grant 51 is not past cliff yet (cliff date: ${cliffDate.toISODate()}), no vesting events needed`);
        }
      } else {
        console.log('\n2. Grant 51 already has vesting events, checking for consistency...');
        
        // Fix 3: Make sure the vested_amount matches the sum of vesting events
        const vestedResult = await db.get(
          'SELECT SUM(shares_vested) as total FROM vesting_event WHERE grant_id = 51'
        );
        
        const totalVestedAmount = vestedResult.total || 0;
        
        if (parseFloat(grant51.vested_amount) !== parseFloat(totalVestedAmount)) {
          console.log(`   Inconsistency found: grant.vested_amount (${grant51.vested_amount}) != sum of vesting events (${totalVestedAmount})`);
          
          // Update the grant record
          await db.run(
            'UPDATE grant_record SET vested_amount = ?, version = version + 1 WHERE grant_id = 51',
            [totalVestedAmount]
          );
          
          console.log(`   Updated grant 51 vested_amount to ${totalVestedAmount}`);
        } else {
          console.log(`   Grant 51 vested_amount (${grant51.vested_amount}) matches sum of vesting events (${totalVestedAmount})`);
        }
      }
    }
    
    console.log('\n3. Checking for other potentially problematic grants...');
    
    // Find grants with inconsistent vested amounts
    const inconsistentGrants = await db.query(`
      SELECT g.grant_id, g.vested_amount as grant_vested, 
             COALESCE(SUM(v.shares_vested), 0) as events_vested
      FROM grant_record g
      LEFT JOIN vesting_event v ON g.grant_id = v.grant_id
      WHERE g.status = 'active' AND g.deleted_at IS NULL
      GROUP BY g.grant_id
      HAVING ABS(g.vested_amount - COALESCE(SUM(v.shares_vested), 0)) > 0.001
    `);
    
    if (inconsistentGrants.length > 0) {
      console.log(`   Found ${inconsistentGrants.length} grants with inconsistent vested amounts`);
      
      for (const grant of inconsistentGrants) {
        console.log(`   Grant ${grant.grant_id}: grant_vested=${grant.grant_vested}, events_vested=${grant.events_vested}`);
        
        // Fix the inconsistency
        await db.run(
          'UPDATE grant_record SET vested_amount = ?, version = version + 1 WHERE grant_id = ?',
          [grant.events_vested, grant.grant_id]
        );
        
        console.log(`   Updated grant ${grant.grant_id} vested_amount to ${grant.events_vested}`);
      }
    } else {
      console.log('   No grants with inconsistent vested amounts found');
    }
    
    console.log('\n===== FIXES COMPLETED SUCCESSFULLY =====');
    console.log('The server should now be able to run without crashing.');
    
  } catch (error) {
    console.error('\n❌ Fix process failed with error:', error);
    console.error('Error details:', error.stack);
  } finally {
    // Close the database connection
    await db.close();
  }
}

// Run the fix
fixProblematicGrants();
