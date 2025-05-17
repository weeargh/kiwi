/**
 * Simple test script to verify that vesting event duplicates are prevented
 */

const db = require('./src/db');
const { DateTime } = require('luxon');

// Configuration
const TENANT_ID = 1;
const USER_ID = 1;
const CURRENT_DATE = DateTime.now().toISODate();

async function runTest() {
  console.log('====== SIMPLE VESTING DUPLICATE PREVENTION TEST ======');
  console.log(`Current date: ${CURRENT_DATE}`);
  
  try {
    // Create a test grant with a date in the past
    const oneYearAgo = DateTime.fromISO(CURRENT_DATE).minus({ years: 2 }).toISODate();
    console.log(`Creating test grant with date: ${oneYearAgo}`);
    
    // Create the grant directly in the database
    const result = await db.run(
      `INSERT INTO grant_record (
        employee_id, tenant_id, grant_date, share_amount, 
        status, vested_amount, created_by, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        1, // employee_id
        TENANT_ID,
        oneYearAgo,
        10000, // share_amount
        'active',
        0, // vested_amount
        USER_ID,
        1 // version
      ]
    );
    
    // Get the ID of the newly created grant
    const grantResult = await db.get(
      'SELECT grant_id FROM grant_record WHERE employee_id = ? AND tenant_id = ? AND grant_date = ? ORDER BY created_at DESC LIMIT 1',
      [1, TENANT_ID, oneYearAgo]
    );
    
    const grantId = grantResult.grant_id;
    console.log(`Created test grant with ID: ${grantId}`);
    
    // Create some test vesting events directly
    console.log('Creating test vesting events...');
    
    // Generate some vesting dates
    const vestDates = [];
    const startDate = DateTime.fromISO(oneYearAgo).plus({ months: 12 });
    
    for (let i = 0; i < 12; i++) {
      vestDates.push(startDate.plus({ months: i }).toISODate());
    }
    
    console.log(`Generated ${vestDates.length} vesting dates`);
    
    // Try to insert the same vesting events multiple times
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`\nAttempt ${attempt} to insert vesting events:`);
      
      for (const vestDate of vestDates) {
        try {
          // Use INSERT OR IGNORE to handle duplicates
          const insertResult = await db.run(
            `INSERT OR IGNORE INTO vesting_event (
              grant_id, tenant_id, vest_date, shares_vested, created_by
            ) VALUES (?, ?, ?, ?, ?)`,
            [grantId, TENANT_ID, vestDate, 100, USER_ID]
          );
          
          console.log(`  - ${vestDate}: ${insertResult.changes > 0 ? 'INSERTED' : 'SKIPPED (already exists)'}`);
        } catch (error) {
          console.error(`  - ${vestDate}: ERROR - ${error.message}`);
        }
      }
    }
    
    // Check final vesting events
    const finalEvents = await db.query(
      'SELECT vest_date, shares_vested FROM vesting_event WHERE grant_id = ? AND tenant_id = ? ORDER BY vest_date',
      [grantId, TENANT_ID]
    );
    
    console.log(`\nFinal vesting events count: ${finalEvents.length}`);
    
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
    console.log('\nVesting date counts:');
    for (const [date, count] of Object.entries(vestDateCounts)) {
      console.log(`  - ${date}: ${count} ${count > 1 ? '(DUPLICATE!)' : ''}`);
    }
    
    if (duplicatesFound) {
      console.error('\nTEST FAILED: Duplicate vesting events were found!');
    } else {
      console.log('\nTEST PASSED: No duplicate vesting events were found!');
      console.log(`Expected events: ${vestDates.length}, Actual events: ${finalEvents.length}`);
    }
    
    // Clean up the test grant and vesting events completely
    console.log('\nCleaning up test data...');
    
    // First delete any vesting events created for this test
    await db.run(
      'DELETE FROM vesting_event WHERE grant_id = ?',
      [grantId]
    );
    console.log(`Deleted all vesting events for test grant ${grantId}`);
    
    // Then delete the test grant completely
    await db.run(
      'DELETE FROM grant_record WHERE grant_id = ?',
      [grantId]
    );
    console.log(`Deleted test grant ${grantId} completely`);
    
    // Verify cleanup was successful
    const remainingGrants = await db.get(
      'SELECT COUNT(*) as count FROM grant_record WHERE grant_id = ?',
      [grantId]
    );
    
    if (remainingGrants.count === 0) {
      console.log('Cleanup successful: All test data has been completely removed');
    } else {
      console.log('Warning: Test data cleanup may not have been complete');
    }
    
    console.log('Test completed successfully.');
  } catch (error) {
    console.error('Test failed with error:', error);
  } finally {
    // Close the database connection
    await db.close();
  }
}

// Run the test
runTest();
