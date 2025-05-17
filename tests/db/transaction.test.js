/**
 * Transaction-based Database Tests
 * 
 * These tests verify database write operations using transactions that
 * are rolled back after each test, ensuring no data is persisted.
 */

const { setupTestEnvironment, initTestDatabase, insertTestData, cleanupTestDatabase } = require('../utils/test-setup');
const Database = require('better-sqlite3');
const path = require('path');
let db;

describe('Transaction-based Database Tests', () => {
  // Store test transaction for use within tests
  let testTransaction;
  
  // Set up test environment before running tests
  beforeAll(() => {
    // Setup test environment without read-only mode
    delete process.env.TEST_READ_ONLY;
    process.env.TEST_READ_ONLY = 'false';
    
    // Setup test environment
    setupTestEnvironment();
    
    // Initialize test database with schema
    const testDb = initTestDatabase();
    
    // Insert test data
    insertTestData(testDb);
    
    // Close the direct connection
    testDb.close();
    
    // Create a fresh connection with writable permissions
    const dbPath = process.env.TEST_DB_PATH || path.join(__dirname, '../../data/test_rsu_platform.db');
    db = new Database(dbPath, { readonly: false });
    
    console.log('Test database setup complete. Ready for transaction tests.');
  });
  
  // Start a fresh transaction before each test
  beforeEach(() => {
    // Start a transaction
    testTransaction = createTestTransaction();
    console.log('Started test transaction');
  });
  
  // Helper function to create a test transaction
  function createTestTransaction() {
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
  
  // Transaction wrapper function for tests
  function transaction(fn) {
    const txFn = db.transaction((params) => {
      // Create a transaction context with the same methods as db
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
  
  // Roll back the transaction after each test
  afterEach(() => {
    // Roll back the transaction to undo any changes
    if (testTransaction) {
      testTransaction.rollback();
      console.log('Rolled back test transaction');
    }
  });
  
  // Clean up after all tests
  afterAll(() => {
    // Close database connection
    db.close();
    
    // Clean up test database if needed
    cleanupTestDatabase();
  });
  
  // Test insert operations
  test('should insert a new employee', () => {
    // Insert a new employee
    const result = db.prepare(
      `INSERT INTO employee (tenant_id, email, first_name, last_name, status)
       VALUES (?, ?, ?, ?, ?)`
    ).run(1, 'test.employee@example.com', 'Test', 'Employee', 'active');
    
    // Verify the insert was successful
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowid).toBeGreaterThan(0);
    
    // Retrieve the inserted employee
    const employee = db.prepare(
      'SELECT * FROM employee WHERE email = ?'
    ).get('test.employee@example.com');
    
    // Verify the retrieved data
    expect(employee).toBeDefined();
    expect(employee.email).toBe('test.employee@example.com');
    expect(employee.first_name).toBe('Test');
    expect(employee.last_name).toBe('Employee');
  });
  
  // Test update operations
  test('should update existing data', () => {
    // First insert test data
    const insertResult = db.prepare(
      `INSERT INTO employee (tenant_id, email, first_name, last_name, status)
       VALUES (?, ?, ?, ?, ?)`
    ).run(1, 'update.test@example.com', 'Before', 'Update', 'active');
    
    const employeeId = insertResult.lastInsertRowid;
    
    // Update the employee
    const updateResult = db.prepare(
      `UPDATE employee SET first_name = ?, last_name = ? WHERE employee_id = ?`
    ).run('After', 'Updated', employeeId);
    
    // Verify the update was successful
    expect(updateResult.changes).toBe(1);
    
    // Retrieve the updated employee
    const employee = db.prepare(
      'SELECT * FROM employee WHERE employee_id = ?'
    ).get(employeeId);
    
    // Verify the updated data
    expect(employee).toBeDefined();
    expect(employee.first_name).toBe('After');
    expect(employee.last_name).toBe('Updated');
  });
  
  // Test delete operations
  test('should delete existing data', () => {
    // First insert test data
    const insertResult = db.prepare(
      `INSERT INTO employee (tenant_id, email, first_name, last_name, status)
       VALUES (?, ?, ?, ?, ?)`
    ).run(1, 'delete.test@example.com', 'To', 'Delete', 'active');
    
    const employeeId = insertResult.lastInsertRowid;
    
    // Verify the employee exists
    const beforeDelete = db.prepare(
      'SELECT * FROM employee WHERE employee_id = ?'
    ).get(employeeId);
    expect(beforeDelete).toBeDefined();
    
    // Delete the employee (soft delete by updating deleted_at)
    const updateResult = db.prepare(
      `UPDATE employee SET deleted_at = CURRENT_TIMESTAMP WHERE employee_id = ?`
    ).run(employeeId);
    
    // Verify the update was successful
    expect(updateResult.changes).toBe(1);
    
    // Retrieve the deleted employee (should be filtered out by deleted_at IS NULL)
    const afterDelete = db.prepare(
      'SELECT * FROM employee WHERE employee_id = ? AND deleted_at IS NULL'
    ).get(employeeId);
    
    // Verify the employee is no longer found
    expect(afterDelete).toBeUndefined();
  });
  
  // Test db.transaction functionality
  test('should handle transactions correctly', () => {
    // Start a nested transaction
    const result = transaction((client) => {
      // Insert a new employee using the transaction client
      const insertResult = client.run(
        `INSERT INTO employee (tenant_id, email, first_name, last_name, status)
         VALUES (?, ?, ?, ?, ?)`,
        [1, 'transaction.test@example.com', 'Transaction', 'Test', 'active']
      );
      
      const employeeId = insertResult.lastInsertRowid;
      
      // Retrieve the employee inside the transaction
      const employee = client.get(
        'SELECT * FROM employee WHERE employee_id = ?', 
        [employeeId]
      );
      
      // Return data from the transaction
      return {
        insertedId: employeeId,
        employee
      };
    });
    
    // Verify the transaction returned the expected data
    expect(result).toBeDefined();
    expect(result.insertedId).toBeGreaterThan(0);
    expect(result.employee).toBeDefined();
    expect(result.employee.email).toBe('transaction.test@example.com');
    
    // Verify the data is visible outside the transaction
    const employee = db.prepare(
      'SELECT * FROM employee WHERE email = ?'
    ).get('transaction.test@example.com');
    
    expect(employee).toBeDefined();
    expect(employee.first_name).toBe('Transaction');
    expect(employee.last_name).toBe('Test');
  });
  
  // Test transaction error handling
  test('should roll back transactions on error', () => {
    // At the beginning of the test, we shouldn't have this employee
    const initialCheck = db.prepare(
      'SELECT * FROM employee WHERE email = ?'
    ).get('rollback.test@example.com');
    expect(initialCheck).toBeUndefined();
    
    // Attempt a transaction that will fail
    expect(() => {
      transaction((client) => {
        // Insert a new employee
        client.run(
          `INSERT INTO employee (tenant_id, email, first_name, last_name, status)
           VALUES (?, ?, ?, ?, ?)`,
          [1, 'rollback.test@example.com', 'Rollback', 'Test', 'active']
        );
        
        // This should exist now
        const midCheck = client.get(
          'SELECT * FROM employee WHERE email = ?', 
          ['rollback.test@example.com']
        );
        expect(midCheck).toBeDefined();
        
        // Throw an error to trigger rollback
        throw new Error('Test error to trigger rollback');
      });
    }).toThrow('Test error to trigger rollback');
    
    // After the transaction failed, the employee should not exist
    const finalCheck = db.prepare(
      'SELECT * FROM employee WHERE email = ?'
    ).get('rollback.test@example.com');
    expect(finalCheck).toBeUndefined();
  });
}); 