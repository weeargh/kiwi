/**
 * Comprehensive Vesting Test Suite
 * 
 * This script includes multiple tests to verify the vesting system functionality:
 * 1. Auto-vesting for new grants
 * 2. Duplicate prevention with concurrent vesting calculations
 * 3. Unique constraint verification
 * 4. Proper cleanup of test data
 */

const db = require('../src/db');
const vestingService = require('../src/services/vesting');
const { DateTime } = require('luxon');

// Configuration
const TENANT_ID = 1;
const USER_ID = 1;
const TIMEZONE = 'America/Los_Angeles';
const CURRENT_DATE = DateTime.now().toISODate();

/**
 * Add startup cleanup function
 */
async function startupCleanup() {
  console.log('\n===== STARTUP CLEANUP: Removing leftover test grants =====');
  try {
    // Temporarily disable foreign key checks for cleanup
    await db.run('PRAGMA foreign_keys = OFF;');
    // Remove vesting events for test grants first
    await db.run(
      'DELETE FROM vesting_event WHERE grant_id IN (SELECT grant_id FROM grant_record WHERE employee_id = 1 AND share_amount = 10000)'
    );
    // Now remove test grants
    await db.run(
      'DELETE FROM grant_record WHERE employee_id = 1 AND share_amount = 10000'
    );
    // Re-enable foreign key checks
    await db.run('PRAGMA foreign_keys = ON;');
    console.log('Startup cleanup complete.');
  } catch (err) {
    console.error('Startup cleanup failed:', err);
  }
}

/**
 * Test 1: Auto-Vesting for New Grants
 * Verifies that auto-vesting works correctly for newly created grants
 */
async function testAutoVesting() {
  console.log('\n===== TEST 1: AUTO-VESTING FOR NEW GRANTS =====');
  let grantId = null;
  try {
    // Create a test grant with a date in the past to ensure vesting events will be created
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
    
    grantId = grantResult.grant_id;
    console.log(`Created test grant with ID: ${grantId}`);
    
    // Process vesting for the new grant
    console.log('Processing vesting for the new grant...');
    const events = await vestingService.processGrantVesting(
      grantId,
      TENANT_ID,
      CURRENT_DATE,
      TIMEZONE,
      USER_ID
    );
    
    // Check vesting events
    const vestingEvents = await db.query(
      'SELECT vest_date, shares_vested FROM vesting_event WHERE grant_id = ? AND tenant_id = ? ORDER BY vest_date',
      [grantId, TENANT_ID]
    );
    
    console.log(`Created ${vestingEvents.length} vesting events for grant ${grantId}`);
    
    // Verify that the correct number of vesting events were created
    if (vestingEvents.length > 0) {
      console.log('✅ TEST PASSED: Auto-vesting created vesting events successfully');
    } else {
      console.log('❌ TEST FAILED: No vesting events were created');
    }
    
    return grantId;
  } catch (error) {
    console.error('Test failed with error:', error);
    return null;
  } finally {
    await cleanupTestData(grantId);
  }
}

/**
 * Test 2: Duplicate Vesting Prevention
 * Verifies that duplicate vesting events are prevented when multiple
 * concurrent vesting calculations are performed for the same grant
 */
async function testDuplicatePrevention() {
  console.log('\n===== TEST 2: DUPLICATE VESTING PREVENTION =====');
  let grantId = null;
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
    
    grantId = grantResult.grant_id;
    console.log(`Created test grant with ID: ${grantId}`);
    
    // Check initial vesting events
    const initialEvents = await db.query(
      'SELECT vest_date, shares_vested FROM vesting_event WHERE grant_id = ? AND tenant_id = ? ORDER BY vest_date',
      [grantId, TENANT_ID]
    );
    
    console.log(`Initial vesting events count: ${initialEvents.length}`);
    
    // Simulate concurrent vesting processes
    const CONCURRENCY_LEVEL = 5;
    console.log(`Simulating ${CONCURRENCY_LEVEL} concurrent vesting processes...`);
    
    const promises = [];
    for (let i = 0; i < CONCURRENCY_LEVEL; i++) {
      promises.push(
        vestingService.processGrantVesting(
          grantId,
          TENANT_ID,
          CURRENT_DATE,
          TIMEZONE,
          USER_ID
        ).then(events => {
          console.log(`Process ${i+1} completed with ${events ? events.length : 0} events created`);
          return events;
        }).catch(err => {
          console.error(`Process ${i+1} failed with error:`, err.message);
          return [];
        })
      );
    }
    
    // Wait for all processes to complete
    console.log('Waiting for all vesting processes to complete...');
    const results = await Promise.allSettled(promises);
    
    console.log('All vesting processes completed');
    
    // Check final vesting events
    const finalEvents = await db.query(
      'SELECT vest_date, shares_vested FROM vesting_event WHERE grant_id = ? AND tenant_id = ? ORDER BY vest_date',
      [grantId, TENANT_ID]
    );
    
    console.log(`Final vesting events count: ${finalEvents.length}`);
    
    // Check for duplicates
    const vestDates = new Set();
    let duplicatesFound = false;
    
    for (const event of finalEvents) {
      if (vestDates.has(event.vest_date)) {
        console.error(`DUPLICATE FOUND: ${event.vest_date}`);
        duplicatesFound = true;
      } else {
        vestDates.add(event.vest_date);
      }
    }
    
    if (duplicatesFound) {
      console.error('❌ TEST FAILED: Duplicate vesting events were found!');
    } else {
      console.log('✅ TEST PASSED: No duplicate vesting events were found!');
      console.log(`Expected events: ${vestDates.size}, Actual events: ${finalEvents.length}`);
    }
    
    return grantId;
  } catch (error) {
    console.error('Test failed with error:', error);
    return null;
  } finally {
    await cleanupTestData(grantId);
  }
}

/**
 * Test 3: Database Constraint Verification
 * Verifies that the unique constraint on vesting_event(grant_id, vest_date) exists
 * and prevents duplicate vesting events
 */
async function testDatabaseConstraint() {
  console.log('\n===== TEST 3: DATABASE CONSTRAINT VERIFICATION =====');
  let grantId = null;
  try {
    // Check database constraints
    console.log('Checking database constraints...');
    const constraints = await db.query("PRAGMA index_list('vesting_event');");
    
    let hasUniqueConstraint = false;
    for (const constraint of constraints) {
      console.log(`- ${constraint.name} (${constraint.unique ? 'UNIQUE' : 'NON-UNIQUE'})`);
      if (constraint.name === 'idx_vesting_event_unique' && constraint.unique === 1) {
        hasUniqueConstraint = true;
      }
    }
    
    if (hasUniqueConstraint) {
      console.log('✅ TEST PASSED: Unique constraint on vesting_event(grant_id, vest_date) exists');
    } else {
      console.log('❌ TEST FAILED: Unique constraint on vesting_event(grant_id, vest_date) is MISSING');
    }
    
    // Create a test grant
    const oneYearAgo = DateTime.now().minus({ years: 2 }).toISODate();
    console.log(`Creating test grant with date: ${oneYearAgo}`);
    
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
    
    grantId = grantResult.grant_id;
    console.log(`Created test grant with ID: ${grantId}`);
    
    // Generate some vesting dates
    const vestDates = [];
    const startDate = DateTime.fromISO(oneYearAgo).plus({ months: 12 });
    
    for (let i = 0; i < 5; i++) {
      vestDates.push(startDate.plus({ months: i }).toISODate());
    }
    
    console.log(`Generated ${vestDates.length} vesting dates for testing`);
    
    // Try to insert the same vesting events multiple times
    console.log('\nTesting INSERT OR IGNORE behavior:');
    
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
          
          console.log(`- ${vestDate}: ${insertResult.changes > 0 ? 'INSERTED' : 'SKIPPED (already exists)'}`);
        } catch (error) {
          console.error(`- ${vestDate}: ERROR - ${error.message}`);
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
      console.log(`- ${date}: ${count} ${count > 1 ? '(DUPLICATE!)' : ''}`);
    }
    
    if (duplicatesFound) {
      console.error('\n❌ TEST FAILED: Duplicate vesting events were found!');
    } else {
      console.log('\n✅ TEST PASSED: No duplicate vesting events were found!');
      console.log(`Expected events: ${vestDates.length}, Actual events: ${finalEvents.length}`);
    }
    
    return grantId;
  } catch (error) {
    console.error('Test failed with error:', error);
    return null;
  } finally {
    await cleanupTestData(grantId);
  }
}

/**
 * Helper function to clean up test data
 */
async function cleanupTestData(grantId) {
  if (!grantId) return;
  
  console.log(`\nCleaning up test data for grant ${grantId}...`);
  
  try {
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
      console.log('✅ Cleanup successful: All test data has been completely removed');
    } else {
      console.log('⚠️ Warning: Test data cleanup may not have been complete');
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('===== VESTING SYSTEM TEST SUITE =====');
  console.log(`Current date: ${CURRENT_DATE}`);
  console.log('Running all tests...\n');
  await startupCleanup();
  try {
    await testAutoVesting();
    await testDuplicatePrevention();
    await testDatabaseConstraint();
    console.log('\n===== ALL TESTS COMPLETED =====');
  } catch (error) {
    console.error('\n❌ Test suite failed with error:', error);
  } finally {
    await db.close();
  }
}

// Add SIGINT handler for extra safety
process.on('SIGINT', async () => {
  console.log('\nSIGINT received. Cleaning up test data...');
  await startupCleanup();
  process.exit();
});

// Run the tests
runAllTests();
