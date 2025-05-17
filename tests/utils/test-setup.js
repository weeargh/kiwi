/**
 * Test Setup Utility
 * 
 * This utility provides functions to setup and manage the test database environment.
 * It handles creating test databases, initializing schemas, and providing test data.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Set up test environment for database testing
function setupTestEnvironment() {
  console.log(`Setting up test environment with database at ${process.env.TEST_DB_PATH}`);
  
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  
  // We need to force DB to reload with test settings
  jest.resetModules();
}

// Initialize a fresh test database with schema
function initTestDatabase() {
  // Delete existing test database to start fresh
  if (fs.existsSync(process.env.TEST_DB_PATH)) {
    // Make a backup of the existing test database
    const backupPath = `${process.env.TEST_DB_PATH}.bak`;
    fs.copyFileSync(process.env.TEST_DB_PATH, backupPath);
    console.log(`Backed up existing test database to ${backupPath}`);
    
    // Delete the test database
    fs.unlinkSync(process.env.TEST_DB_PATH);
    console.log('Deleted existing test database');
  }
  
  // Create data directory if it doesn't exist
  const dataDir = path.dirname(process.env.TEST_DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Created data directory at ${dataDir}`);
  }
  
  // Always create the database in read-write mode initially
  console.log(`Creating test database in read-write mode`);
  const db = new Database(process.env.TEST_DB_PATH);
  
  // Enable foreign keys
  db.prepare('PRAGMA foreign_keys = ON').run();
  
  // Create basic schema - this is a simplified version
  // of your actual schema for testing purposes
  const createTablesSQL = `
    -- Tenant table
    CREATE TABLE IF NOT EXISTS tenant (
      tenant_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      display_decimal_places INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP
    );
    
    -- User table
    CREATE TABLE IF NOT EXISTS user (
      user_id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id)
    );
    
    -- Employee table
    CREATE TABLE IF NOT EXISTS employee (
      employee_id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id)
    );
    
    -- Equity pool table
    CREATE TABLE IF NOT EXISTS equity_pool (
      pool_id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      initial_amount DECIMAL(20, 3) NOT NULL,
      total_pool DECIMAL(20, 3) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id)
    );
    
    -- PPS history table
    CREATE TABLE IF NOT EXISTS pps_history (
      pps_id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      effective_date DATE NOT NULL,
      price_per_share DECIMAL(20, 3) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id)
    );
    
    -- Grant record table
    CREATE TABLE IF NOT EXISTS grant_record (
      grant_id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      pool_id INTEGER, 
      grant_date DATE NOT NULL,
      shares_granted DECIMAL(20, 3) NOT NULL,
      vested_amount DECIMAL(20, 3) NOT NULL DEFAULT 0,
      vesting_schedule_id INTEGER,
      vesting_schedule_type TEXT NOT NULL DEFAULT 'standard',
      vesting_start_date DATE,
      status TEXT NOT NULL DEFAULT 'active',
      unvested_shares_returned DECIMAL(20, 3) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id),
      FOREIGN KEY (employee_id) REFERENCES employee(employee_id),
      FOREIGN KEY (pool_id) REFERENCES equity_pool(pool_id)
    );
    
    -- Vesting event table
    CREATE TABLE IF NOT EXISTS vesting_event (
      vesting_id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      grant_id INTEGER NOT NULL,
      vest_date DATE NOT NULL,
      shares_vested DECIMAL(20, 3) NOT NULL,
      pps_snapshot DECIMAL(20, 3),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id),
      FOREIGN KEY (grant_id) REFERENCES grant_record(grant_id)
    );
    
    -- Audit log table
    CREATE TABLE IF NOT EXISTS audit_log (
      log_id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id),
      FOREIGN KEY (user_id) REFERENCES user(user_id)
    );
  `;
  
  // Split and execute each CREATE TABLE statement
  const statements = createTablesSQL.split(';').filter(stmt => stmt.trim().length > 0);
  for (const stmt of statements) {
    db.prepare(stmt).run();
  }
  
  console.log('Created test database schema');
  
  // Close the direct connection to the database
  db.close();
  
  // Now reload the db module to use the newly created database
  jest.resetModules();
  return require('../../src/db');
}

// Insert basic test data
function insertTestData(db) {
  console.log('Inserting test data');
  
  // Handle both db module and direct database connection
  const dbInstance = db.db || db;
  
  // Create test tenant
  dbInstance.prepare(`
    INSERT INTO tenant (tenant_id, name)
    VALUES (1, 'Test Company')
  `).run();
  
  // Create test admin user
  dbInstance.prepare(`
    INSERT INTO user (user_id, tenant_id, email, password_hash, name, role)
    VALUES (1, 1, 'admin@test.com', '$2b$10$test_hash_value', 'Test Admin', 'admin')
  `).run();
  
  // Create test employee user
  dbInstance.prepare(`
    INSERT INTO user (user_id, tenant_id, email, password_hash, name, role)
    VALUES (2, 1, 'employee@test.com', '$2b$10$test_hash_value', 'Test Employee', 'employee')
  `).run();
  
  // Create test employees for tests
  dbInstance.prepare(`
    INSERT INTO employee (employee_id, tenant_id, email, first_name, last_name, status)
    VALUES (1, 1, 'john.doe@example.com', 'John', 'Doe', 'active')
  `).run();
  
  dbInstance.prepare(`
    INSERT INTO employee (employee_id, tenant_id, email, first_name, last_name, status)
    VALUES (2, 1, 'jane.smith@example.com', 'Jane', 'Smith', 'active')
  `).run();
  
  dbInstance.prepare(`
    INSERT INTO employee (employee_id, tenant_id, email, first_name, last_name, status)
    VALUES (3, 1, 'bob.test@example.com', 'Bob', 'Test', 'inactive')
  `).run();
  
  // Create equity pool
  dbInstance.prepare(`
    INSERT INTO equity_pool (pool_id, tenant_id, initial_amount, total_pool)
    VALUES (1, 1, 10000.000, 10000.000)
  `).run();
  
  // Create PPS history
  dbInstance.prepare(`
    INSERT INTO pps_history (pps_id, tenant_id, effective_date, price_per_share)
    VALUES (1, 1, date('now', '-1 year'), 1.000)
  `).run();
  
  dbInstance.prepare(`
    INSERT INTO pps_history (pps_id, tenant_id, effective_date, price_per_share)
    VALUES (2, 1, date('now', '-6 month'), 1.500)
  `).run();
  
  dbInstance.prepare(`
    INSERT INTO pps_history (pps_id, tenant_id, effective_date, price_per_share)
    VALUES (3, 1, date('now'), 2.000)
  `).run();
  
  // Create test grants
  dbInstance.prepare(`
    INSERT INTO grant_record (grant_id, tenant_id, employee_id, pool_id, grant_date, 
                            shares_granted, vested_amount, vesting_schedule_type, 
                            vesting_start_date, status)
    VALUES (1, 1, 1, 1, date('now', '-1 year'), 1000.000, 250.000, 'standard', 
           date('now', '-1 year'), 'active')
  `).run();
  
  dbInstance.prepare(`
    INSERT INTO grant_record (grant_id, tenant_id, employee_id, pool_id, grant_date, 
                            shares_granted, vested_amount, vesting_schedule_type, 
                            vesting_start_date, status)
    VALUES (2, 1, 2, 1, date('now', '-6 month'), 500.000, 62.500, 'standard', 
           date('now', '-6 month'), 'active')
  `).run();
  
  // Create vesting events
  dbInstance.prepare(`
    INSERT INTO vesting_event (vesting_id, tenant_id, grant_id, vest_date, shares_vested, pps_snapshot)
    VALUES (1, 1, 1, date('now', '-9 month'), 62.500, 1.000)
  `).run();
  
  dbInstance.prepare(`
    INSERT INTO vesting_event (vesting_id, tenant_id, grant_id, vest_date, shares_vested, pps_snapshot)
    VALUES (2, 1, 1, date('now', '-6 month'), 62.500, 1.000)
  `).run();
  
  dbInstance.prepare(`
    INSERT INTO vesting_event (vesting_id, tenant_id, grant_id, vest_date, shares_vested, pps_snapshot)
    VALUES (3, 1, 1, date('now', '-3 month'), 62.500, 1.500)
  `).run();
  
  dbInstance.prepare(`
    INSERT INTO vesting_event (vesting_id, tenant_id, grant_id, vest_date, shares_vested, pps_snapshot)
    VALUES (4, 1, 1, date('now'), 62.500, 2.000)
  `).run();
  
  dbInstance.prepare(`
    INSERT INTO vesting_event (vesting_id, tenant_id, grant_id, vest_date, shares_vested, pps_snapshot)
    VALUES (5, 1, 2, date('now', '-3 month'), 31.250, 1.500)
  `).run();
  
  dbInstance.prepare(`
    INSERT INTO vesting_event (vesting_id, tenant_id, grant_id, vest_date, shares_vested, pps_snapshot)
    VALUES (6, 1, 2, date('now'), 31.250, 2.000)
  `).run();
  
  console.log('Test data inserted');
}

// Function to run after tests to clean up
function cleanupTestDatabase() {
  try {
    // Optionally close any open connections
    // Delete the test database if needed
    if (process.env.TEST_CLEANUP === 'true' && fs.existsSync(process.env.TEST_DB_PATH)) {
      fs.unlinkSync(process.env.TEST_DB_PATH);
      console.log('Cleaned up test database');
    }
  } catch (error) {
    console.error('Error cleaning up test database:', error);
  }
}

// NOTE: tenant.display_decimal_places is for frontend display only. Backend always uses 3 dp for all calculations and storage.

// --- Integration test helpers (stubs, replace with real logic as needed) ---
async function setupTestTenant() {
  // Return dummy tenantId and adminCookie for test
  return { tenantId: 1, adminCookie: 'admin-session-cookie' };
}
async function createTestEmployee(tenantId, opts = {}) {
  // Return dummy employeeId
  return 1;
}
async function createTestGrant(tenantId, employeeId, opts = {}) {
  // Return dummy grantId
  return 1;
}
async function loginAsAdmin() {
  // Return dummy admin cookie
  return 'admin-session-cookie';
}
async function fastForwardDate() {
  // No-op stub
}
async function createTestEmployeeAndGrant({ tenantId }) {
  return { employeeId: 1, grantId: 1 };
}
async function fastForwardVesting({ grantId, tenantId, sharesToVest }) {
  // No-op stub
}
async function getPoolInfo(tenantId) {
  return { returned: 0, available: 0, totalPool: 0, granted: 0 };
}
async function getGrantInfo(grantId, tenantId) {
  return { unvestedSharesReturned: 0, vestedSharesReturned: 0 };
}

module.exports = {
  setupTestEnvironment,
  initTestDatabase,
  insertTestData,
  cleanupTestDatabase,
  setupTestTenant,
  createTestEmployee,
  createTestGrant,
  loginAsAdmin,
  fastForwardDate,
  createTestEmployeeAndGrant,
  fastForwardVesting,
  getPoolInfo,
  getGrantInfo
}; 