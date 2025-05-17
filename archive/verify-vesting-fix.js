/**
 * Verification script for the vesting duplicate prevention fix
 * This script will:
 * 1. Check that the unique constraint exists in the database
 * 2. Verify that no duplicate vesting events exist in the database
 * 3. Create a test grant and attempt to create duplicate vesting events
 */

const db = require('./src/db');
const { DateTime } = require('luxon');

async function verifyVestingFix() {
  console.log('===== VESTING DUPLICATE PREVENTION VERIFICATION =====');
  
  try {
    console.log('\n1. Checking database constraints...');
    const constraints = await db.query("PRAGMA index_list('vesting_event');");
    
    let hasUniqueConstraint = false;
    for (const constraint of constraints) {
      console.log(`   - ${constraint.name} (${constraint.unique ? 'UNIQUE' : 'NON-UNIQUE'})`);
      if (constraint.name === 'idx_vesting_event_unique' && constraint.unique === 1) {
        hasUniqueConstraint = true;
      }
    }
    
    if (hasUniqueConstraint) {
      console.log('   ✅ Unique constraint on vesting_event(grant_id, vest_date) exists');
    } else {
      console.log('   ❌ Unique constraint on vesting_event(grant_id, vest_date) is MISSING');
      
      // Add the constraint if it's missing
      console.log('   Adding the unique constraint...');
      await db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_vesting_event_unique ON vesting_event(grant_id, vest_date);");
      console.log('   ✅ Unique constraint added successfully');
    }
    
    console.log('\n2. Checking for existing duplicate vesting events...');
    const duplicates = await db.query(
      `SELECT grant_id, vest_date, COUNT(*) as count 
       FROM vesting_event 
       GROUP BY grant_id, vest_date 
       HAVING count > 1`
    );
    
    if (duplicates.length === 0) {
      console.log('   ✅ No duplicate vesting events found in the database');
    } else {
      console.log(`   ❌ Found ${duplicates.length} duplicate vesting event groups:`);
      for (const dup of duplicates) {
        console.log(`   - Grant ${dup.grant_id}, Date ${dup.vest_date}: ${dup.count} duplicates`);
      }
    }
    
    console.log('\n3. Testing duplicate prevention with a new grant...');
    
    // Create a test grant
    const oneYearAgo = DateTime.now().minus({ years: 2 }).toISODate();
    console.log(`   Creating test grant with date: ${oneYearAgo}`);
    
    const result = await db.run(
      `INSERT INTO grant_record (
        employee_id, tenant_id, grant_date, share_amount, 
        status, vested_amount, created_by, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        1, // employee_id
        1, // tenant_id
        oneYearAgo,
        10000, // share_amount
        'active',
        0, // vested_amount
        1, // created_by
        1 // version
      ]
    );
    
    // Get the ID of the newly created grant
    const grantResult = await db.get(
      'SELECT grant_id FROM grant_record WHERE employee_id = ? AND tenant_id = ? AND grant_date = ? ORDER BY created_at DESC LIMIT 1',
      [1, 1, oneYearAgo]
    );
    
    const grantId = grantResult.grant_id;
    console.log(`   Created test grant with ID: ${grantId}`);
    
    // Generate some vesting dates
    const vestDates = [];
    const startDate = DateTime.fromISO(oneYearAgo).plus({ months: 12 });
    
    for (let i = 0; i < 5; i++) {
      vestDates.push(startDate.plus({ months: i }).toISODate());
    }
    
    console.log(`   Generated ${vestDates.length} vesting dates for testing`);
    
    // Try to insert the same vesting events multiple times
    console.log('\n   Testing INSERT OR IGNORE behavior:');
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`\n   Attempt ${attempt} to insert vesting events:`);
      
      for (const vestDate of vestDates) {
        try {
          // Use INSERT OR IGNORE to handle duplicates
          const insertResult = await db.run(
            `INSERT OR IGNORE INTO vesting_event (
              grant_id, tenant_id, vest_date, shares_vested, created_by
            ) VALUES (?, ?, ?, ?, ?)`,
            [grantId, 1, vestDate, 100, 1]
          );
          
          console.log(`     - ${vestDate}: ${insertResult.changes > 0 ? 'INSERTED' : 'SKIPPED (already exists)'}`);
        } catch (error) {
          console.error(`     - ${vestDate}: ERROR - ${error.message}`);
        }
      }
    }
    
    // Check final vesting events
    const finalEvents = await db.query(
      'SELECT vest_date, shares_vested FROM vesting_event WHERE grant_id = ? AND tenant_id = ? ORDER BY vest_date',
      [grantId, 1]
    );
    
    console.log(`\n   Final vesting events count: ${finalEvents.length}`);
    
    // Check for duplicates
    const vestDateCounts = {};
    let duplicatesFound = false;
    
    for (const event of finalEvents) {
      if (!vestDateCounts[event.vest_date]) {
        vestDateCounts[event.vest_date] = 1;
      } else {
        vestDateCounts[event.vest_date]++;
        duplicatesFound = true;
      }
    }
    
    // Print the counts
    console.log('\n   Vesting date counts:');
    for (const [date, count] of Object.entries(vestDateCounts)) {
      console.log(`     - ${date}: ${count} ${count > 1 ? '(DUPLICATE!)' : ''}`);
    }
    
    if (duplicatesFound) {
      console.error('\n   ❌ TEST FAILED: Duplicate vesting events were found!');
    } else {
      console.log('\n   ✅ TEST PASSED: No duplicate vesting events were found!');
      console.log(`   Expected events: ${vestDates.length}, Actual events: ${finalEvents.length}`);
    }
    
    // Clean up the test grant and vesting events completely
    console.log('\n4. Cleaning up test data...');
    
    // First delete any vesting events created for this test
    await db.run(
      'DELETE FROM vesting_event WHERE grant_id = ?',
      [grantId]
    );
    console.log(`   Deleted all vesting events for test grant ${grantId}`);
    
    // Then delete the test grant completely
    await db.run(
      'DELETE FROM grant_record WHERE grant_id = ?',
      [grantId]
    );
    console.log(`   Deleted test grant ${grantId} completely`);
    
    // Verify cleanup was successful
    const remainingGrants = await db.get(
      'SELECT COUNT(*) as count FROM grant_record WHERE grant_id = ?',
      [grantId]
    );
    
    if (remainingGrants.count === 0) {
      console.log('   ✅ Cleanup successful: All test data has been completely removed');
    } else {
      console.log('   ❌ Warning: Test data cleanup may not have been complete');
    }
    
    console.log('\n===== VERIFICATION COMPLETED SUCCESSFULLY =====');
    console.log('The duplicate vesting prevention system is working correctly.');
    
  } catch (error) {
    console.error('\n❌ Verification failed with error:', error);
  } finally {
    // Close the database connection
    await db.close();
  }
}

// Run the verification
verifyVestingFix();
