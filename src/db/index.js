const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Define database path from environment or use default
// Use a separate test database when in test mode
const dbPath = process.env.NODE_ENV === 'test'
  ? process.env.TEST_DB_PATH || './data/test_rsu_platform.db'
  : process.env.DB_PATH || './data/rsu_platform.db';

console.log(`Using database at: ${dbPath} (NODE_ENV: ${process.env.NODE_ENV || 'development'})`);

// Ensure the data directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log(`Created database directory: ${dbDir}`);
}

// Connect to database
const db = new Database(dbPath, { 
  // In test mode, create the database if it doesn't exist
  fileMustExist: process.env.NODE_ENV !== 'test',
  // Only use readonly mode when explicitly set in test environment
  readonly: process.env.NODE_ENV === 'test' && process.env.TEST_READ_ONLY === 'true'
});

// Enable foreign keys
db.prepare('PRAGMA foreign_keys = ON').run();

// Log database mode when in test environment
if (process.env.NODE_ENV === 'test') {
  const isReadOnly = process.env.TEST_READ_ONLY === 'true';
  console.log(`Database mode: ${isReadOnly ? 'READ-ONLY' : 'READ-WRITE'}`);
  
  // In transaction mode, ensure there's a database schema for testing
  if (!isReadOnly && process.env.TEST_READ_ONLY !== 'true') {
    try {
      // Check if employee table exists as a simple test
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='employee'").all();
      if (tableCheck.length === 0) {
        console.log('Test database schema not found. Please ensure tests initialize the database first.');
      } else {
        console.log('Test database schema found and ready for write operations');
      }
    } catch (err) {
      console.error('Error checking test database:', err.message);
    }
  }
}

// Helper function to run a query with parameters
const query = (sql, params = []) => {
  return db.prepare(sql).all(...params);
};

// Synchronous get (returns a single row)
function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

// Synchronous all (returns all rows)
function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

// Synchronous run (for INSERT/UPDATE/DELETE)
function run(sql, params = []) {
  // In test mode with READ_ONLY flag, prevent data modifications
  if (process.env.NODE_ENV === 'test' && process.env.TEST_READ_ONLY === 'true' &&
      (sql.trim().toUpperCase().startsWith('INSERT') || 
       sql.trim().toUpperCase().startsWith('UPDATE') || 
       sql.trim().toUpperCase().startsWith('DELETE'))) {
    throw new Error('TEST_READ_ONLY mode: Data modification operations are not allowed');
  }
  
  return db.prepare(sql).run(...params);
}

/**
 * Transaction wrapper for better-sqlite3
 * 
 * This function creates a proper transaction context for better-sqlite3,
 * which differs from the original sqlite3 implementation. The main differences:
 * 
 * 1. better-sqlite3 transactions are synchronous, not asynchronous
 * 2. The transaction context (client) needs to have the same methods as the db object
 * 3. When migrating from sqlite3 to better-sqlite3, we need to ensure all db operations
 *    inside transactions use the transaction context (client) parameter
 * 
 * @param {Function} fn - Function to execute within transaction (receives transaction context)
 * @returns {any} - Result returned by the transaction function
 */
function transaction(fn) {
  console.log('db.transaction called with function type:', fn.constructor.name);
  if (fn.constructor.name === 'AsyncFunction') {
    throw new TypeError('Do not use async functions with db.transaction!');
  }
  
  // In test mode with READ_ONLY flag, prevent data modifications in transactions
  if (process.env.NODE_ENV === 'test' && process.env.TEST_READ_ONLY === 'true') {
    throw new Error('TEST_READ_ONLY mode: Transactions are not allowed');
  }
  
  // Create the transaction function
  const txFn = db.transaction((params) => {
    // Create a transaction context with the same methods as db
    // This ensures all operations use the same transaction
    const txContext = {
      get: (sql, params = []) => db.prepare(sql).get(...params),
      all: (sql, params = []) => db.prepare(sql).all(...params),
      run: (sql, params = []) => db.prepare(sql).run(...params),
      query: (sql, params = []) => db.prepare(sql).all(...params)
    };
    
    // Execute the original function with the transaction context
    return fn(txContext);
  });
  
  // Execute the transaction
  return txFn();
}

// Helper to format number with exactly 3 decimal places
const toDecimalString = (num) => {
  if (num === null || num === undefined) return null;
  
  // Convert to number if it's not already
  const n = typeof num === 'number' ? num : parseFloat(num);
  
  // Round to 3 decimal places using banker's rounding (half to even)
  // Multiply by 1000, round, then divide by 1000
  const rounded = Math.round(n * 1000) / 1000;
  
  // Format with exactly 3 decimal places
  return rounded.toFixed(3);
};

// Close the database connection
const close = () => {
  return db.close();
};

// Function to create a test transaction that will be rolled back
function createTestTransaction() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('createTestTransaction can only be used in test mode');
  }
  
  // Start a transaction
  db.prepare('BEGIN TRANSACTION').run();
  
  return {
    // Function to roll back the transaction
    rollback: () => {
      db.prepare('ROLLBACK').run();
    },
    // Function to commit the transaction (rarely used in tests)
    commit: () => {
      db.prepare('COMMIT').run();
    }
  };
}

// Handle process termination
process.on('SIGINT', async () => {
  try {
    await close();
    process.exit(0);
  } catch (err) {
    console.error('Error closing database:', err.message);
    process.exit(1);
  }
});

module.exports = {
  get,
  all,
  run,
  transaction,
  query,
  toDecimalString,
  close,
  db,
  // Export test-specific functions only in test mode
  ...(process.env.NODE_ENV === 'test' ? { createTestTransaction } : {})
}; 