/**
 * Test script to create a new grant and verify auto-vesting functionality
 */
const db = require('./src/db');
const grantModel = require('./src/models/grant');
const dateUtils = require('./src/utils/date');

async function testAutoVesting() {
  try {
    console.log('Starting auto-vesting test...');
    
    // Get tenant info
    const tenant = await db.get('SELECT tenant_id, timezone FROM tenant WHERE tenant_id = 2');
    if (!tenant) {
      console.error('Tenant not found');
      process.exit(1);
    }
    
    // Get an active employee
    const employee = await db.get(`SELECT employee_id FROM employee WHERE status = 'active' AND tenant_id = 2 LIMIT 1`);
    if (!employee) {
      console.error('No active employee found');
      process.exit(1);
    }
    
    // Count existing vesting events
    const beforeCount = await db.get('SELECT COUNT(*) as count FROM vesting_event');
    console.log(`Before: ${beforeCount.count} vesting events in database`);
    
    // Create a backdated grant (16 months ago to ensure it's past the cliff)
    const currentDate = dateUtils.getCurrentDate(tenant.timezone);
    const currentDateObj = dateUtils.parseDate(currentDate, tenant.timezone);
    const grantDateObj = currentDateObj.minus({ months: 16 });
    const grantDate = grantDateObj.toISODate();
    
    console.log(`Creating new grant with date ${grantDate} (16 months ago)`);
    
    // Create the grant using the model (this should trigger auto-vesting)
    const grantData = {
      employee_id: employee.employee_id,
      grant_date: grantDate,
      share_amount: "1000.000"
    };
    
    const newGrant = await grantModel.createGrant(
      tenant.tenant_id,
      grantData,
      1 // Admin user ID
    );
    
    console.log(`Created new grant with ID: ${newGrant.id}`);
    
    // Wait a bit for async processing
    console.log('Waiting for vesting processing to complete...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Count vesting events after creation
    const afterCount = await db.get('SELECT COUNT(*) as count FROM vesting_event');
    console.log(`After: ${afterCount.count} vesting events in database`);
    
    // Check if new vesting events were created
    const newEvents = afterCount.count - beforeCount.count;
    console.log(`${newEvents} new vesting events were created`);
    
    // Get vesting events for this grant
    const grantEvents = await db.query(
      'SELECT vest_date, shares_vested FROM vesting_event WHERE grant_id = ? ORDER BY vest_date',
      [newGrant.id]
    );
    
    console.log(`Vesting events for grant ${newGrant.id}:`);
    grantEvents.forEach(event => {
      console.log(`- ${event.vest_date}: ${event.shares_vested} shares`);
    });
    
    // Check vesting processing status
    const processingStatus = await db.get(
      'SELECT status, message FROM vesting_processing_status WHERE grant_id = ? ORDER BY created_at DESC LIMIT 1',
      [newGrant.id]
    );
    
    if (processingStatus) {
      console.log(`Vesting processing status: ${processingStatus.status}`);
      console.log(`Message: ${processingStatus.message}`);
    } else {
      console.log('No vesting processing status found');
    }
    
    console.log('Test completed');
  } catch (error) {
    console.error('Error during test:', error);
  } finally {
    // Close the database connection
    db.close();
  }
}

// Run the test
testAutoVesting();
