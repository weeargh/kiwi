/**
 * Script to fix duplicate vesting events
 * 
 * This script identifies and removes duplicate vesting events,
 * keeping only one event per grant and vest date.
 */

const db = require('./src/db');

async function fixDuplicateVestingEvents() {
  console.log('Starting duplicate vesting events cleanup...');
  
  try {
    // Get all duplicate vesting events
    const duplicates = await db.query(`
      SELECT grant_id, vest_date, COUNT(*) as count 
      FROM vesting_event 
      GROUP BY grant_id, vest_date 
      HAVING count > 1
    `);
    
    console.log(`Found ${duplicates.length} sets of duplicate vesting events`);
    
    // Process each set of duplicates
    for (const dup of duplicates) {
      console.log(`Processing duplicates for grant ${dup.grant_id}, date ${dup.vest_date} (${dup.count} events)`);
      
      // Get all duplicate events for this grant and date
      const events = await db.query(`
        SELECT vesting_id, grant_id, vest_date, shares_vested, created_at
        FROM vesting_event
        WHERE grant_id = ? AND vest_date = ?
        ORDER BY created_at
      `, [dup.grant_id, dup.vest_date]);
      
      // Keep the first event (earliest created_at) and delete the rest
      const keepEvent = events[0];
      const deleteEvents = events.slice(1);
      
      console.log(`  Keeping event ID ${keepEvent.vesting_id}, deleting ${deleteEvents.length} duplicates`);
      
      // Begin transaction
      await db.run('BEGIN TRANSACTION');
      
      try {
        // Delete duplicate events
        for (const event of deleteEvents) {
          await db.run('DELETE FROM vesting_event WHERE vesting_id = ?', [event.vesting_id]);
        }
        
        // Get the grant's current vested amount
        const grant = await db.get(`
          SELECT grant_id, vested_amount, share_amount, version
          FROM grant_record
          WHERE grant_id = ?
        `, [dup.grant_id]);
        
        if (grant) {
          // Calculate the correct vested amount (sum of all unique vesting events)
          const vestedSum = await db.get(`
            SELECT SUM(shares_vested) as total
            FROM vesting_event
            WHERE grant_id = ?
          `, [dup.grant_id]);
          
          // Update the grant's vested amount
          await db.run(`
            UPDATE grant_record
            SET vested_amount = ?, version = version + 1
            WHERE grant_id = ?
          `, [vestedSum.total, dup.grant_id]);
          
          console.log(`  Updated grant ${dup.grant_id} vested amount to ${vestedSum.total}`);
        }
        
        // Commit transaction
        await db.run('COMMIT');
        console.log(`  Successfully fixed duplicates for grant ${dup.grant_id}, date ${dup.vest_date}`);
      } catch (error) {
        // Rollback on error
        await db.run('ROLLBACK');
        console.error(`  Error fixing duplicates for grant ${dup.grant_id}:`, error);
      }
    }
    
    console.log('Duplicate vesting events cleanup completed');
  } catch (error) {
    console.error('Error during duplicate cleanup:', error);
  } finally {
    // Close database connection
    db.close();
  }
}

// Run the cleanup
fixDuplicateVestingEvents();
