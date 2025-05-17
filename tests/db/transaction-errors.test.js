/**
 * Tests for database transaction error handling
 */

const path = require('path');
const fs = require('fs');
const { setupTestEnvironment, initTestDatabase, insertTestData, cleanupTestDatabase } = require('../utils/test-setup');

// Set test database path
process.env.TEST_DB_PATH = path.join(__dirname, '../../data/test_transaction_errors.db');
process.env.TEST_READ_ONLY = 'false';
process.env.NODE_ENV = 'test';

describe('Transaction Error Handling', () => {
  let db;
  
  // Set up test database before running tests
  beforeAll(() => {
    // Initialize test environment
    setupTestEnvironment();
    
    // Initialize test database with schema and get database connection
    db = initTestDatabase();
    
    // Insert test data
    insertTestData(db);
    
    console.log('Test database setup complete for transaction error tests');
  });
  
  // Clean up after tests
  afterAll(() => {
    cleanupTestDatabase();
  });

  describe('Error Recovery Tests', () => {
    test('should roll back transaction on error', () => {
      // Use the createTestTransaction function from the db module
      const testTx = db.createTestTransaction();
      
      // Get initial employee count
      const initialCount = db.get(
        'SELECT COUNT(*) as count FROM employee WHERE tenant_id = ? AND deleted_at IS NULL',
        [1]
      ).count;
      
      try {
        // First insert a valid employee
        db.run(
          `INSERT INTO employee (tenant_id, email, first_name, last_name, status)
           VALUES (?, ?, ?, ?, ?)`,
          [1, 'valid.test@example.com', 'Valid', 'Test', 'active']
        );
        
        // Then try to insert an invalid employee (missing required fields)
        db.run(
          `INSERT INTO employee (tenant_id, email)
           VALUES (?, ?)`,
          [1, 'invalid.test@example.com']
        );
        
        // We should never reach this point due to the constraint violation
        fail('Should have thrown an error due to constraint violation');
      } catch (err) {
        // We expect an error
        expect(err).toBeDefined();
        
        // Roll back the transaction
        testTx.rollback();
        
        // Check that no employees were added (due to rollback)
        const afterCount = db.get(
          'SELECT COUNT(*) as count FROM employee WHERE tenant_id = ? AND deleted_at IS NULL',
          [1]
        ).count;
        
        expect(afterCount).toBe(initialCount);
      }
    });

    test('should maintain data consistency after a failed transaction', () => {
      // Use the transaction wrapper function
      try {
        db.transaction((client) => {
          // Get initial employee data to verify afterwards
          const initialEmployees = client.all(
            'SELECT * FROM employee WHERE tenant_id = ? AND deleted_at IS NULL',
            [1]
          );
          
          // Update an employee (this should succeed)
          client.run(
            'UPDATE employee SET status = ? WHERE employee_id = ? AND tenant_id = ?',
            ['inactive', 1, 1]
          );
          
          // Force a constraint violation
          client.run(
            'INSERT INTO grant_record (tenant_id, employee_id, grant_date, shares_granted) VALUES (?, ?, ?, ?)',
            [1, 999999, '2023-01-01', 100] // Employee ID doesn't exist, violating foreign key constraint
          );
          
          // We should never reach this point
          return 'Transaction completed';
        });
        
        // If we reach this point, the test should fail
        fail('Transaction should have thrown an error');
      } catch (err) {
        // Verify error was thrown
        expect(err).toBeDefined();
        
        // Verify employee status was not changed (transaction rolled back)
        const employee = db.get(
          'SELECT status FROM employee WHERE employee_id = ? AND tenant_id = ?',
          [1, 1]
        );
        
        // Status should still be 'active' since the transaction was rolled back
        expect(employee.status).toBe('active');
      }
    });

    test('should properly handle nested operations', () => {
      // Get initial grant count
      const initialGrantCount = db.get(
        'SELECT COUNT(*) as count FROM grant_record WHERE tenant_id = ?',
        [1]
      ).count;
      
      try {
        db.transaction((client) => {
          // Create a new employee
          const result = client.run(
            `INSERT INTO employee (tenant_id, email, first_name, last_name, status)
             VALUES (?, ?, ?, ?, ?)`,
            [1, 'nested.test@example.com', 'Nested', 'Test', 'active']
          );
          
          const employeeId = result.lastInsertRowid;
          
          // Create a grant for the employee (this should succeed)
          client.run(
            `INSERT INTO grant_record (tenant_id, employee_id, grant_date, shares_granted, vesting_schedule_type, status)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [1, employeeId, '2023-01-01', 1000, 'standard', 'active']
          );
          
          // Now try to create an invalid vesting event (should fail and roll back both operations)
          client.run(
            `INSERT INTO vesting_event (tenant_id, grant_id, vest_date, shares_vested)
             VALUES (?, ?, ?, ?)`,
            [1, 999999, '2023-02-01', 20.833] // Invalid grant_id
          );
          
          return 'Transaction completed';
        });
        
        // If we reach this point, the test should fail
        fail('Nested transaction should have thrown an error');
      } catch (err) {
        // Verify error was thrown
        expect(err).toBeDefined();
        
        // Verify no grants were added (transaction rolled back)
        const afterGrantCount = db.get(
          'SELECT COUNT(*) as count FROM grant_record WHERE tenant_id = ?',
          [1]
        ).count;
        
        expect(afterGrantCount).toBe(initialGrantCount);
        
        // Verify the employee wasn't created either
        const employee = db.get(
          'SELECT employee_id FROM employee WHERE email = ? AND tenant_id = ?',
          ['nested.test@example.com', 1]
        );
        
        expect(employee).toBeUndefined();
      }
    });
  });

  describe('Transaction Function Validation', () => {
    test('should reject async functions in transaction', () => {
      // Attempt to use an async function with transaction
      const asyncFn = async (client) => {
        return client.get('SELECT 1 as value');
      };
      
      // This should throw a TypeError
      expect(() => {
        db.transaction(asyncFn);
      }).toThrow(TypeError);
    });

    test('should allow synchronous functions in transaction', () => {
      // Use a proper synchronous function
      const syncFn = (client) => {
        return client.get('SELECT 1 as value');
      };
      
      // This should succeed
      const result = db.transaction(syncFn);
      expect(result.value).toBe(1);
    });
  });

  describe('Unique Constraint Violations', () => {
    test('should handle unique constraint violations correctly', () => {
      // Try to create two employees with the same email
      const email = 'unique.test@example.com';
      
      // Create the first employee (should succeed)
      db.run(
        `INSERT INTO employee (tenant_id, email, first_name, last_name, status)
         VALUES (?, ?, ?, ?, ?)`,
        [1, email, 'Unique', 'Test', 'active']
      );
      
      // Create a transaction to try to add a duplicate email
      const testTx = db.createTestTransaction();
      
      try {
        // Try to create another employee with the same email
        db.run(
          `INSERT INTO employee (tenant_id, email, first_name, last_name, status)
           VALUES (?, ?, ?, ?, ?)`,
          [1, email, 'Duplicate', 'Test', 'active']
        );
        
        // Should fail before reaching here
        fail('Should have thrown a unique constraint violation');
      } catch (err) {
        // Verify error was thrown
        expect(err).toBeDefined();
        expect(err.message).toMatch(/UNIQUE constraint failed|constraint violation/i);
        
        // Roll back the transaction
        testTx.rollback();
        
        // Verify there's only one employee with this email
        const count = db.get(
          'SELECT COUNT(*) as count FROM employee WHERE email = ? AND tenant_id = ?',
          [email, 1]
        ).count;
        
        expect(count).toBe(1);
      }
    });
  });
}); 