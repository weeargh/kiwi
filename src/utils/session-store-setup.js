/**
 * Session Store Setup Utility
 * 
 * This utility ensures the session store database is properly set up
 * with the correct schema for better-sqlite3-session-store.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

/**
 * Initialize the session store database
 * @param {string} dbPath - Path to the sessions database file
 * @returns {Object} - Result of the initialization
 */
function initializeSessionStore(dbPath) {
  const result = {
    success: false,
    message: '',
    error: null
  };

  try {
    // Ensure parent directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Connect to database
    const db = new Database(dbPath);
    
    // Check if sessions table exists with correct schema
    const tableInfo = db.prepare("PRAGMA table_info(sessions)").all();
    
    if (tableInfo.length === 0) {
      // Table doesn't exist, create it
      db.prepare(`
        CREATE TABLE IF NOT EXISTS sessions (
          sid TEXT PRIMARY KEY,
          sess TEXT,
          expire INTEGER
        )
      `).run();
      
      // Create index on expire column
      db.prepare(`
        CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire)
      `).run();
      
      result.message = 'Sessions table created successfully';
    } else {
      // Table exists, verify schema
      const hasExpire = tableInfo.some(col => col.name === 'expire');
      const hasSid = tableInfo.some(col => col.name === 'sid');
      const hasSess = tableInfo.some(col => col.name === 'sess');
      
      if (!hasExpire || !hasSid || !hasSess) {
        // Schema is incorrect, drop and recreate
        db.prepare('DROP TABLE IF EXISTS sessions').run();
        db.prepare(`
          CREATE TABLE sessions (
            sid TEXT PRIMARY KEY,
            sess TEXT,
            expire INTEGER
          )
        `).run();
        
        // Create index on expire column
        db.prepare(`
          CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire)
        `).run();
        
        result.message = 'Sessions table recreated with correct schema';
      } else {
        result.message = 'Sessions table already exists with correct schema';
      }
    }
    
    // Close the database connection
    db.close();
    
    result.success = true;
  } catch (err) {
    result.error = err;
    result.message = `Error initializing session store: ${err.message}`;
  }
  
  return result;
}

module.exports = {
  initializeSessionStore
}; 