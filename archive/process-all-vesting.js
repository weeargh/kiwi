/**
 * Process Vesting for All Grants
 * 
 * This script calculates and processes vesting for all active grants in the system,
 * regardless of their grant date. It is designed to be flexible enough to handle:
 * 
 * 1. Recent grants that need regular vesting calculation
 * 2. Backdated grants from any year (including as far back as 2010 or earlier)
 * 3. Grants that have already passed their cliff period
 * 
 * The script automatically detects if a grant is older than 12 months and bypasses
 * the cliff restriction in that case, ensuring that all appropriate vesting events
 * are created.
 * 
 * This script can be run:
 * - Periodically (e.g., daily) as a scheduled task
 * - After data migration
 * - To catch up on vesting calculations for newly added historical grants
 * 
 * Usage: node process-all-vesting.js
 */

const sqlite3 = require('sqlite3').verbose();
const { DateTime } = require('luxon');
const path = require('path');

// Connect to the database directly
const dbPath = path.join(__dirname, 'data', 'rsu_platform.db');
const db = new sqlite3.Database(dbPath);

/**
 * Process vesting for all active grants that have a grant date earlier than today
 * This script can be run periodically to ensure all grants have their vesting up to date
 */
async function processAllBackdatedGrants() {
  console.log("Looking for all grants with historical grant dates...");
  
  // Current date in ISO format
  const currentDate = new Date().toISOString().split('T')[0];
  
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        g.id, 
        g.tenant_id, 
        g.employee_id,
        g.grant_date, 
        g.share_amount, 
        g.vested_amount,
        g.version,
        e.first_name || ' ' || e.last_name as employee_name
      FROM grant_record g
      JOIN employee e ON g.employee_id = e.employee_id AND e.tenant_id = g.tenant_id
      WHERE g.status = 'active' AND g.deleted_at IS NULL 
        AND g.grant_date <= ?
      ORDER BY g.grant_date ASC
    `, [currentDate], async (err, grants) => {
      if (err) return reject(err);
      
      if (grants.length === 0) {
        console.log("No grants with historical grant dates found.");
        return resolve([]);
      }
      
      console.log(`Found ${grants.length} grants with historical grant dates`);
      
      const processedGrants = [];
      
      for (const grant of grants) {
        console.log(`\nProcessing grant ${grant.id} for ${grant.employee_name}`);
        console.log(`Grant date: ${grant.grant_date}, Share amount: ${grant.share_amount}`);
        
        try {
          // Get existing vesting events
          const existingEvents = await new Promise((resolve, reject) => {
            db.all(`
              SELECT vest_date, shares_vested
              FROM vesting_event
              WHERE grant_id = ? AND tenant_id = ?
            `, [grant.id, grant.tenant_id], (err, events) => {
              if (err) return reject(err);
              resolve(events || []);
            });
          });
          
          console.log(`Found ${existingEvents.length} existing vesting events`);
          const existingDates = new Set(existingEvents.map(e => e.vest_date));
          
          // Calculate all 48 vesting dates
          const vestingDates = [];
          const grantDateTime = DateTime.fromISO(grant.grant_date);
          
          for (let month = 1; month <= 48; month++) {
            const targetMonth = grantDateTime.plus({ months: month });
            const daysInMonth = targetMonth.daysInMonth;
            const originalDay = grantDateTime.day;
            const adjustedDay = Math.min(originalDay, daysInMonth);
            const vestingDate = targetMonth.set({ day: adjustedDay });
            vestingDates.push(vestingDate.toISODate());
          }
          
          // Calculate standard tranche size
          const standardTranche = (parseFloat(grant.share_amount) / 48).toFixed(3);
          const tranches = Array(47).fill(standardTranche);
          
          // Calculate the sum of the first 47 tranches
          const sum47 = tranches.reduce((sum, tranche) => sum + parseFloat(tranche), 0);
          
          // Calculate final tranche to ensure total matches exactly
          const finalTranche = (parseFloat(grant.share_amount) - sum47).toFixed(3);
          tranches.push(finalTranche);
          
          // Filter dates to process
          const datesToProcess = [];
          for (let i = 0; i < vestingDates.length; i++) {
            const date = vestingDates[i];
            
            // Check for cliff (12 months) unless grant is older than 12 months
            const grantDate = new Date(grant.grant_date);
            const twelveMonthsLater = new Date(grantDate);
            twelveMonthsLater.setMonth(twelveMonthsLater.getMonth() + 12);
            const currentDateObj = new Date(currentDate);
            
            // Determine if we should bypass cliff
            const bypassCliff = currentDateObj >= twelveMonthsLater;
            
            // Include date if:
            // 1. It's on or before current date
            // 2. Not already processed
            // 3. Either past cliff or cliff check bypassed
            if (date <= currentDate && !existingDates.has(date) && (bypassCliff || i >= 11)) {
              datesToProcess.push({ date, index: i });
            }
          }
          
          console.log(`Found ${datesToProcess.length} dates to process`);
          
          if (datesToProcess.length === 0) {
            console.log('No new vesting events to create');
            continue;
          }
          
          // Process each date
          const createdEvents = [];
          let currentVersion = grant.version;
          let currentVestedAmount = parseFloat(grant.vested_amount);
          
          for (const item of datesToProcess) {
            const { date, index } = item;
            const sharesVested = parseFloat(tranches[index]);
            
            try {
              // Get the most recent PPS (price per share)
              const ppsSnapshot = await new Promise((resolve, reject) => {
                db.get(`
                  SELECT price_per_share
                  FROM pps_history
                  WHERE tenant_id = ? AND effective_date <= ?
                  ORDER BY effective_date DESC, created_at DESC
                  LIMIT 1
                `, [grant.tenant_id, date], (err, pps) => {
                  if (err) return reject(err);
                  resolve(pps ? pps.price_per_share : null);
                });
              });

              // Insert vesting event
              console.log(`Creating vesting event for ${date} with ${sharesVested} shares`);
              
              const eventId = await new Promise((resolve, reject) => {
                db.run(`
                  INSERT INTO vesting_event (
                    grant_id, tenant_id, vest_date, shares_vested, pps_snapshot, created_by
                  ) VALUES (?, ?, ?, ?, ?, ?)
                `, [grant.id, grant.tenant_id, date, sharesVested, ppsSnapshot, 1], function(err) {
                  if (err) return reject(err);
                  resolve(this.lastID);
                });
              });
              
              // Update grant's vested amount and version
              currentVestedAmount += sharesVested;
              currentVersion += 1;
              
              await new Promise((resolve, reject) => {
                db.run(`
                  UPDATE grant_record 
                  SET vested_amount = ?, version = ? 
                  WHERE grant_id = ? AND tenant_id = ? AND version = ?
                `, [
                  currentVestedAmount.toFixed(3), 
                  currentVersion, 
                  grant.id, 
                  grant.tenant_id, 
                  currentVersion - 1
                ], function(err) {
                  if (err) return reject(err);
                  resolve();
                });
              });
              
              createdEvents.push({ date, sharesVested });
              console.log(`Successfully created vesting event for ${date}`);
            } catch (err) {
              console.error(`Error processing vesting for date ${date}:`, err);
            }
          }
          
          if (createdEvents.length > 0) {
            processedGrants.push({
              grantId: grant.id,
              employeeName: grant.employee_name,
              grantDate: grant.grant_date,
              eventsCreated: createdEvents.length
            });
          }
          
          console.log(`Created ${createdEvents.length} vesting events for grant ${grant.id}`);
        } catch (err) {
          console.error(`Error processing grant ${grant.id}:`, err);
        }
      }
      
      resolve(processedGrants);
    });
  });
}

// Main function
async function main() {
  try {
    console.log("Processing all grants with historical dates...");
    const processedGrants = await processAllBackdatedGrants();
    
    console.log("\nSummary of processing:");
    if (processedGrants.length === 0) {
      console.log("No grants required vesting updates");
    } else {
      console.log(`Created vesting events for ${processedGrants.length} grants:`);
      processedGrants.forEach(grant => {
        console.log(`- ${grant.employeeName} (ID: ${grant.grantId}): ${grant.eventsCreated} events created`);
      });
    }
    
    console.log("\nProcessing completed!");
  } catch (err) {
    console.error("Error:", err);
  } finally {
    // Close database
    db.close();
  }
}

// Run the script
main(); 