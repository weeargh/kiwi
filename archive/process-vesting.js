const vestingService = require('./src/services/vesting');
const db = require('./src/db');

async function processVesting() {
  try {
    console.log('Connecting to database...');
    console.log('Connected!');
    
    // Get all active grants
    const grants = await db.query(
      `SELECT grant_id, tenant_id, grant_date 
       FROM grant_record 
       WHERE status = 'active' AND deleted_at IS NULL`
    );
    
    console.log(`Found ${grants.length} active grants`);
    
    // Process each grant
    for (const grant of grants) {
      console.log(`Processing grant ${grant.grant_id}...`);
      try {
        const events = await vestingService.processGrantVesting(
          grant.grant_id, 
          grant.tenant_id, 
          new Date().toISOString().split('T')[0], 
          'UTC', 
          1 // Admin user ID
        );
        console.log(`Created ${events.length} vesting events for grant ${grant.grant_id}`);
      } catch (err) {
        console.error(`Error processing grant ${grant.grant_id}:`, err.message);
      }
    }
    
    console.log('Done!');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

// Process vesting
processVesting(); 