/**
 * Test script to verify that vesting event duplicates are prevented
 * This script will:
 * 1. Create a new grant
 * 2. Trigger multiple concurrent vesting calculations for the same grant
 * 3. Verify that no duplicate vesting events are created
 */

const db = require('./src/db');
const vestingService = require('./src/services/vesting');
const { DateTime } = require('luxon');

// Configuration
const TENANT_ID = 1;
const USER_ID = 1;
const TIMEZONE = 'America/Los_Angeles';
const CURRENT_DATE = DateTime.now().toISODate();

// Number of concurrent vesting processes to simulate
const CONCURRENCY_LEVEL = 5;

async function runTest() {
  console.log('====== VESTING DUPLICATE PREVENTION TEST ======');
  console.log(`Current date: ${CURRENT_DATE}`);
  console.log(`Concurrency level: ${CONCURRENCY_LEVEL}`);
  
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
    
    const grantId = grantResult.grant_id;
    console.log(`Created test grant with ID: ${grantId}`);
    
    // Wait for auto-vesting to complete
    console.log('Waiting for auto-vesting to complete...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check initial vesting events
    const initialEvents = await db.query(
      'SELECT vest_date, shares_vested FROM vesting_event WHERE grant_id = ? AND tenant_id = ? ORDER BY vest_date',
      [grantId, TENANT_ID]
    );
    
    console.log(`Initial vesting events count: ${initialEvents.length}`);
    
    // Simulate concurrent vesting processes
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
    
    // Wait for all processes to complete with a timeout
    console.log('Waiting for all vesting processes to complete...');
    const results = await Promise.allSettled(promises);
    
    console.log('All vesting processes completed with results:');
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        console.log(`Process ${index+1}: Success - created ${result.value ? result.value.length : 0} events`);
      } else {
        console.log(`Process ${index+1}: Failed - ${result.reason}`);
      }
    });
    
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
      console.error('TEST FAILED: Duplicate vesting events were found!');
    } else {
      console.log('TEST PASSED: No duplicate vesting events were found!');
      console.log(`Expected events: ${vestDates.size}, Actual events: ${finalEvents.length}`);
    }
    
    // Clean up the test grant and vesting events completely
    console.log('Cleaning up test data...');
    
    // First delete any vesting events created for this test
    await db.run(
      'DELETE FROM vesting_event WHERE grant_id = ?',
      [grantId]
    );
    
    // Then delete the test grant completely
    await db.run(
      'DELETE FROM grant_record WHERE grant_id = ?',
      [grantId]
    );
    
    console.log(`Completely removed test grant ${grantId} and all its vesting events`);
    
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
