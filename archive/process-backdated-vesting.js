const sqlite3 = require('sqlite3').verbose();
const { DateTime } = require('luxon');
const path = require('path');

// Connect to the database directly to avoid transaction issues
const dbPath = path.join(__dirname, 'data', 'rsu_platform.db');
const db = new sqlite3.Database(dbPath);

// Function to process a single grant's vesting
async function processGrantVesting(grantId, tenantId, grantDate) {
  return new Promise((resolve, reject) => {
    console.log(`Processing grant ${grantId}...`);
    
    // Check if grant exists and is active
    db.get(
      `SELECT 
        grant_id, employee_id, grant_date, share_amount, vested_amount, status, version 
       FROM grant_record 
       WHERE grant_id = ? AND tenant_id = ? AND status = 'active' AND deleted_at IS NULL`,
      [grantId, tenantId],
      (err, grant) => {
        if (err) return reject(err);
        if (!grant) return reject(new Error(`Grant ${grantId} not found or not active`));
        
        // Get existing vesting events
        db.all(
          `SELECT vest_date FROM vesting_event WHERE grant_id = ? AND tenant_id = ?`,
          [grantId, tenantId],
          (err, existingEvents) => {
            if (err) return reject(err);
            
            // Create a set of existing dates
            const existingDates = new Set(existingEvents.map(e => e.vest_date));
            
            // Calculate vesting dates (48 months from grant date)
            const vestingDates = [];
            const grantDateTime = DateTime.fromISO(grantDate);
            
            for (let month = 1; month <= 48; month++) {
              const targetMonth = grantDateTime.plus({ months: month });
              const daysInMonth = targetMonth.daysInMonth;
              const originalDay = grantDateTime.day;
              const adjustedDay = Math.min(originalDay, daysInMonth);
              const vestingDate = targetMonth.set({ day: adjustedDay });
              vestingDates.push(vestingDate.toISODate());
            }
            
            // Calculate tranche size (share_amount / 48)
            const standardTranche = (grant.share_amount / 48).toFixed(3);
            
            // Use standard tranche for first 47 months
            const tranches = Array(47).fill(standardTranche);
            
            // Calculate sum of first 47 tranches
            const sum47 = tranches.reduce((sum, tranche) => sum + parseFloat(tranche), 0);
            
            // Calculate final tranche to ensure total equals share_amount exactly
            const finalTranche = (grant.share_amount - sum47).toFixed(3);
            tranches.push(finalTranche);
            
            // Current date
            const currentDate = new Date().toISOString().split('T')[0];
            
            // Check if the grant date is more than 12 months in the past
            // If so, we should bypass the cliff restriction
            const grantDate = new Date(grant.grant_date);
            const currentDateObj = new Date(currentDate);
            const twelveMonthsLater = new Date(grantDate);
            twelveMonthsLater.setMonth(twelveMonthsLater.getMonth() + 12);
            const bypassCliff = currentDateObj >= twelveMonthsLater;

            console.log(`Grant date: ${grant.grant_date}, Cliff date: ${twelveMonthsLater.toISOString().split('T')[0]}`);
            console.log(`Current date: ${currentDate}, Bypass cliff: ${bypassCliff}`);
            
            // Filter dates for processing (past cliff or bypass cliff, and not already processed)
            const datesToProcess = [];
            for (let i = 0; i < vestingDates.length; i++) {
              const date = vestingDates[i];
              // Either past cliff or bypass cliff, and not already processed
              if (date <= currentDate && !existingDates.has(date) && (bypassCliff || i >= 11)) {
                datesToProcess.push({ date, index: i });
              }
            }
            
            if (datesToProcess.length === 0) {
              console.log(`No vesting events to create for grant ${grantId}`);
              return resolve([]);
            }
            
            console.log(`Creating ${datesToProcess.length} vesting events for grant ${grantId}`);
            
            // Create vesting events one by one
            const createdEvents = [];
            let processedCount = 0;
            
            const processNext = (index) => {
              if (index >= datesToProcess.length) {
                return resolve(createdEvents);
              }
              
              const { date, index: trancheIndex } = datesToProcess[index];
              
              // Get the most recent PPS for this vest date
              db.get(
                `SELECT price_per_share 
                 FROM pps_history 
                 WHERE tenant_id = ? AND effective_date <= ? AND deleted_at IS NULL
                 ORDER BY effective_date DESC, created_at DESC
                 LIMIT 1`,
                [tenantId, date],
                (err, pps) => {
                  if (err) {
                    console.error(`Error getting PPS: ${err.message}`);
                    processNext(index + 1);
                    return;
                  }
                  
                  const ppsSnapshot = pps ? pps.price_per_share : null;
                  
                  // Create the vesting event
                  db.run(
                    `INSERT INTO vesting_event (
                      grant_id, tenant_id, vest_date, shares_vested, pps_snapshot, created_by
                    ) VALUES (?, ?, ?, ?, ?, ?)`,
                    [grantId, tenantId, date, tranches[trancheIndex], ppsSnapshot, 1], // User ID 1 (admin)
                    function(err) {
                      if (err) {
                        console.error(`Error creating vesting event: ${err.message}`);
                        processNext(index + 1);
                        return;
                      }
                      
                      const eventId = this.lastID;
                      
                      // Update grant's vested amount
                      const newVestedAmount = (parseFloat(grant.vested_amount) + parseFloat(tranches[trancheIndex])).toFixed(3);
                      
                      db.run(
                        'UPDATE grant_record SET vested_amount = ?, version = ? WHERE grant_id = ? AND tenant_id = ? AND version = ?',
                        [newVestedAmount, grant.version + 1, grantId, tenantId, grant.version],
                        function(err) {
                          if (err) {
                            console.error(`Error updating grant: ${err.message}`);
                          } else {
                            createdEvents.push({ id: eventId, date, shares: tranches[trancheIndex] });
                            // Update grant version for next iteration
                            grant.version = grant.version + 1;
                            grant.vested_amount = newVestedAmount;
                          }
                          
                          processNext(index + 1);
                        }
                      );
                    }
                  );
                }
              );
            };
            
            // Start processing
            processNext(0);
          }
        );
      }
    );
  });
}

// Main function to process all grants
async function processAllGrants() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT grant_id, tenant_id, grant_date FROM grant_record WHERE status = 'active' AND deleted_at IS NULL`,
      [],
      async (err, grants) => {
        if (err) return reject(err);
        
        console.log(`Found ${grants.length} active grants`);
        
        for (const grant of grants) {
          try {
            await processGrantVesting(grant.grant_id, grant.tenant_id, grant.grant_date);
          } catch (err) {
            console.error(`Error processing grant ${grant.grant_id}:`, err.message);
          }
        }
        
        resolve();
      }
    );
  });
}

// Run the process
(async () => {
  try {
    console.log('Processing all grants...');
    await processAllGrants();
    console.log('Done!');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    // Close the database connection
    db.close();
    process.exit(0);
  }
})(); 