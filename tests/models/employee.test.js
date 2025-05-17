/**
 * Tests for the employee model
 */

const path = require('path');
const fs = require('fs');
const { setupTestEnvironment, initTestDatabase, insertTestData, cleanupTestDatabase } = require('../utils/test-setup');

// Set test database path
process.env.TEST_DB_PATH = path.join(__dirname, '../../data/test_rsu_platform.db');

describe('Employee Model Tests', () => {
  let db;
  let employeeModel;
  
  // Set up test database before running tests
  beforeAll(() => {
    // First set up in write mode to initialize everything
    delete process.env.TEST_READ_ONLY;
    process.env.TEST_READ_ONLY = 'false';
    process.env.NODE_ENV = 'test';
    
    // Initialize test environment
    setupTestEnvironment();
    
    // Initialize test database with schema and get database connection
    db = initTestDatabase();
    
    // Insert test data
    insertTestData(db.db);
    
    // Now switch to read-only mode for the read-only tests
    process.env.TEST_READ_ONLY = 'true';
    jest.resetModules();
    
    // Now we can require the employee model which will use the initialized database
    employeeModel = require('../../src/models/employee');
    
    console.log('Test database setup complete for employee model tests');
  });
  
  // Clean up after tests
  afterAll(() => {
    // Clean up test database
    cleanupTestDatabase();
  });

  // Read-only tests
  describe('Read-only operations', () => {
    const TEST_TENANT_ID = 1;
    
    test('should get employee by ID', () => {
      const employee = employeeModel.getEmployee(1, TEST_TENANT_ID);
      
      expect(employee).toBeDefined();
      expect(employee.id).toBeDefined();
      expect(employee.email).toBeDefined();
      expect(employee.firstName).toBeDefined();
      expect(employee.lastName).toBeDefined();
      expect(employee.status).toBeDefined();
    });
    
    test('should get all employees', () => {
      const employees = employeeModel.getEmployees(TEST_TENANT_ID);
      
      expect(Array.isArray(employees)).toBe(true);
      expect(employees.length).toBeGreaterThan(0);
      
      // Verify employee object structure
      const employee = employees[0];
      expect(employee.id).toBeDefined();
      expect(employee.email).toBeDefined();
      expect(employee.firstName).toBeDefined();
      expect(employee.lastName).toBeDefined();
    });
    
    test('should return null for non-existent employee', () => {
      const employee = employeeModel.getEmployee(9999, TEST_TENANT_ID);
      expect(employee).toBeNull();
    });
    
    test('should search employees by name', () => {
      // Search for employees with a common name pattern
      const employees = employeeModel.getEmployees(TEST_TENANT_ID, { search: 'Test' });
      
      // If test employees with this pattern exist, verify search works
      if (employees.length > 0) {
        expect(employees[0].firstName.includes('Test') || 
              employees[0].lastName.includes('Test') || 
              employees[0].email.includes('Test')).toBe(true);
      }
    });
    
    test('should get employees by status', () => {
      const activeEmployees = employeeModel.getEmployees(TEST_TENANT_ID, { status: 'active' });
      
      expect(Array.isArray(activeEmployees)).toBe(true);
      activeEmployees.forEach(employee => {
        expect(employee.status).toBe('active');
      });
    });
    
    test('should count employees correctly', () => {
      const count = employeeModel.countEmployees(TEST_TENANT_ID);
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThan(0);
      
      // Count should match the number of employees returned by getEmployees
      const employees = employeeModel.getEmployees(TEST_TENANT_ID);
      expect(count).toBeGreaterThanOrEqual(employees.length);
    });
  });
});

// Transaction tests in a separate describe block to use different database mode
describe('Employee Model Transaction Tests', () => {
  let db;
  let employeeModel;
  const TEST_TENANT_ID = 1;
  const TEST_USER_ID = 999;
  
  // Set up test database for write operations
  beforeAll(() => {
    // Setup write mode test environment
    delete process.env.TEST_READ_ONLY;
    process.env.TEST_READ_ONLY = 'false';
    process.env.NODE_ENV = 'test';
    
    // Initialize test environment
    setupTestEnvironment();
    
    // Initialize test database with schema and get db connection
    db = initTestDatabase();
    
    // Insert test data
    insertTestData(db.db);
    
    // Load the employee model with the initialized database
    jest.resetModules();
    employeeModel = require('../../src/models/employee');
    
    console.log('Test database setup complete for employee transaction tests');
  });
  
  // Clean up test database after all tests
  afterAll(() => {
    cleanupTestDatabase();
  });
  
  // Write operation tests
  test('should create a new employee', () => {
    const newEmployee = {
      email: 'test.create@example.com',
      firstName: 'TestCreate',
      lastName: 'Employee',
      status: 'active'
    };
    
    const employee = employeeModel.createEmployee(TEST_TENANT_ID, newEmployee, TEST_USER_ID);
    
    expect(employee).toBeDefined();
    expect(employee.id).toBeGreaterThan(0);
    expect(employee.email).toBe(newEmployee.email);
    expect(employee.firstName).toBe(newEmployee.firstName);
    expect(employee.lastName).toBe(newEmployee.lastName);
    expect(employee.status).toBe(newEmployee.status);
    
    // Verify employee was created
    const createdEmployee = employeeModel.getEmployee(employee.id, TEST_TENANT_ID);
    expect(createdEmployee).toBeDefined();
    expect(createdEmployee.email).toBe(newEmployee.email);
  });
  
  test('should update an employee', () => {
    const newEmployee = {
      email: 'test.update@example.com',
      firstName: 'TestUpdate',
      lastName: 'OriginalName',
      status: 'active'
    };
    
    const employee = employeeModel.createEmployee(TEST_TENANT_ID, newEmployee, TEST_USER_ID);
    
    // Update the employee
    const updates = {
      lastName: 'UpdatedName',
      status: 'inactive'
    };
    
    const updatedEmployee = employeeModel.updateEmployee(employee.id, TEST_TENANT_ID, updates, TEST_USER_ID);
    
    // Verify updates
    expect(updatedEmployee).toBeDefined();
    expect(updatedEmployee.lastName).toBe(updates.lastName);
    expect(updatedEmployee.status).toBe(updates.status);
    
    // Verify other fields weren't changed
    expect(updatedEmployee.email).toBe(newEmployee.email);
    expect(updatedEmployee.firstName).toBe(newEmployee.firstName);
    
    // Verify changes are reflected in getEmployee
    const retrievedEmployee = employeeModel.getEmployee(employee.id, TEST_TENANT_ID);
    expect(retrievedEmployee.lastName).toBe(updates.lastName);
    expect(retrievedEmployee.status).toBe(updates.status);
  });
  
  test('should delete an employee', () => {
    const newEmployee = {
      email: 'test.delete@example.com',
      firstName: 'TestDelete',
      lastName: 'Employee',
      status: 'active'
    };
    
    const employee = employeeModel.createEmployee(TEST_TENANT_ID, newEmployee, TEST_USER_ID);
    
    // Verify employee exists
    let retrievedEmployee = employeeModel.getEmployee(employee.id, TEST_TENANT_ID);
    expect(retrievedEmployee).toBeDefined();
    
    // Delete the employee
    const result = employeeModel.deleteEmployee(employee.id, TEST_TENANT_ID, TEST_USER_ID);
    expect(result).toBeTruthy();
    
    // Verify employee no longer exists (or is marked as deleted)
    retrievedEmployee = employeeModel.getEmployee(employee.id, TEST_TENANT_ID);
    expect(retrievedEmployee).toBeNull();
  });
  
  test('should validate employee email uniqueness', () => {
    // First create a test employee
    const employee1 = {
      email: 'unique.test@example.com',
      firstName: 'Unique',
      lastName: 'Test',
      status: 'active'
    };
    
    employeeModel.createEmployee(TEST_TENANT_ID, employee1, TEST_USER_ID);
    
    // Try to create another employee with the same email
    const employee2 = {
      email: 'unique.test@example.com', // Same email
      firstName: 'Another',
      lastName: 'User',
      status: 'active'
    };
    
    // Expect creation to fail with a duplicate email error
    expect(() => {
      employeeModel.createEmployee(TEST_TENANT_ID, employee2, TEST_USER_ID);
    }).toThrow(/already exists/i);
  });
  
  test('should get employees with grant summary', () => {
    const employees = employeeModel.getEmployeesWithGrantSummary(TEST_TENANT_ID);
    
    expect(Array.isArray(employees)).toBe(true);
    if (employees.length > 0) {
      // Check summary properties
      const employee = employees[0];
      expect(employee).toBeDefined();
      expect(employee.id).toBeDefined();
      expect(employee.firstName).toBeDefined();
      expect(employee.lastName).toBeDefined();
      
      // These are specific to the grant summary
      expect(employee).toHaveProperty('totalShares');
      expect(employee).toHaveProperty('vestedShares');
      expect(employee).toHaveProperty('vestedPercent');
    }
  });
}); 