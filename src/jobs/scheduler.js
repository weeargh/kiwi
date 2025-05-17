/**
 * Job Scheduler
 * 
 * Sets up scheduled jobs for the application using node-cron.
 * This runs background tasks at specific intervals to ensure
 * data is kept up-to-date without user intervention.
 */

const cron = require('node-cron');
const { processAllTenantsVesting } = require('./scheduled-vesting');

/**
 * Initialize all scheduled jobs
 */
function initializeScheduler() {
  console.log('Initializing scheduled jobs');
  
  // Schedule the vesting job to run daily at 2:00 AM in the server's timezone
  // Format: second(0-59) minute(0-59) hour(0-23) day(1-31) month(1-12) weekday(0-6)
  cron.schedule('0 0 2 * * *', async () => {
    console.log('Running scheduled vesting job - daily at 2:00 AM');
    try {
      const result = await processAllTenantsVesting();
      console.log('Scheduled vesting job completed:', result);
    } catch (err) {
      console.error('Scheduled vesting job failed:', err);
    }
  });
  
  // Run the vesting job immediately on startup to ensure everything is up to date
  // Use a timeout to allow the server to fully initialize first
  setTimeout(async () => {
    console.log('Running initial vesting job on startup');
    try {
      const result = await processAllTenantsVesting();
      console.log('Initial vesting job completed:', result);
    } catch (err) {
      console.error('Initial vesting job failed:', err);
      // Log detailed error information but continue server operation
      console.error('Error details:', err.stack);
      if (err.cause) {
        console.error('Caused by:', err.cause);
      }
    }
  }, 5000); // 5 second delay
  
  console.log('All scheduled jobs initialized');
}

module.exports = {
  initializeScheduler
}; 