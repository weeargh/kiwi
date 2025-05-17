/**
 * Tests for the grant model
 */

const { setupTestEnvironment, initTestDatabase, insertTestData, cleanupTestDatabase } = require('../utils/test-setup');
const grantModel = require('../../src/models/grant');
const employeeModel = require('../../src/models/employee');
const dateUtils = require('../../src/utils/date');

describe('Grant Model Tests', () => {
  let db;
  
  // Set up test database before running tests
  beforeAll(() => {
    // Setup read-only test environment
    process.env.TEST_READ_ONLY = 'true';
    process.env.NODE_ENV = 'test';
    
    // Initialize test environment
    setupTestEnvironment();
    
    // Initialize test database with schema
    const testDb = initTestDatabase();
    
    // Insert test data
    insertTestData(testDb);
    
    // Close direct database connection
    testDb.close();
    
    // Get the database connection from the db module
    jest.resetModules();
    db = require('../../src/db');
    
    console.log('Test database setup complete for grant model tests');
  });
  
  // Clean up after tests
  afterAll(() => {
    // Clean up test database
    cleanupTestDatabase();
  });

  // Read-only tests
  describe('Read-only operations', () => {
    test('should get grant by ID', async () => {
      // Assuming there's at least one grant in the test data with ID 1
      const grant = await grantModel.getGrantById(1);
      
      expect(grant).toBeDefined();
      expect(grant.grant_id).toBe(1);
      expect(grant.employee_id).toBeDefined();
      expect(grant.grant_date).toBeDefined();
      expect(grant.shares_granted).toBeDefined();
      expect(grant.status).toBeDefined();
    });
    
    test('should get all grants', async () => {
      const grants = await grantModel.getAllGrants();
      
      expect(Array.isArray(grants)).toBe(true);
      expect(grants.length).toBeGreaterThan(0);
      
      // Verify grant object structure
      const grant = grants[0];
      expect(grant.grant_id).toBeDefined();
      expect(grant.employee_id).toBeDefined();
      expect(grant.grant_date).toBeDefined();
      expect(grant.shares_granted).toBeDefined();
    });
    
    test('should return null for non-existent grant', async () => {
      const grant = await grantModel.getGrantById(9999);
      expect(grant).toBeNull();
    });
    
    test('should get grants by employee ID', async () => {
      // Assuming there's at least one grant in the test data for employee 1
      const employeeId = 1;
      const grants = await grantModel.getGrantsByEmployeeId(employeeId);
      
      expect(Array.isArray(grants)).toBe(true);
      if (grants.length > 0) {
        grants.forEach(grant => {
          expect(grant.employee_id).toBe(employeeId);
        });
      }
    });
    
    test('should get active grants', async () => {
      const activeGrants = await grantModel.getGrantsByStatus('active');
      
      expect(Array.isArray(activeGrants)).toBe(true);
      activeGrants.forEach(grant => {
        expect(grant.status).toBe('active');
      });
    });
    
    test('should get grants by date range', async () => {
      // Define a date range that should include grants
      const startDate = new Date('2020-01-01');
      const endDate = new Date('2025-01-01');
      
      const grants = await grantModel.getGrantsByDateRange(startDate, endDate);
      
      expect(Array.isArray(grants)).toBe(true);
      if (grants.length > 0) {
        grants.forEach(grant => {
          const grantDate = new Date(grant.grant_date);
          expect(grantDate >= startDate && grantDate <= endDate).toBe(true);
        });
      }
    });
    
    test('should calculate vested amount correctly', async () => {
      // Assuming there's at least one grant in the test data with vesting
      const grant = await grantModel.getGrantById(1);
      
      if (grant) {
        const asOfDate = new Date(); // Current date
        const grantDate = new Date(grant.grant_date);
        
        // Only test if the grant is old enough to have some vesting
        if (asOfDate > grantDate) {
          const vestedAmount = await grantModel.calculateVestedAmount(grant.grant_id, asOfDate);
          
          expect(typeof vestedAmount).toBe('number');
          expect(vestedAmount).toBeGreaterThanOrEqual(0);
          expect(vestedAmount).toBeLessThanOrEqual(grant.shares_granted);
        }
      }
    });
  });
});

// Transaction tests in a separate describe block to use different database mode
describe('Grant Model Transaction Tests', () => {
  let db;
  let testTransaction;
  let testEmployeeId; // To store a test employee ID for creating grants
  
  // Set up test database for write operations
  beforeAll(async () => {
    // Setup write mode test environment
    delete process.env.TEST_READ_ONLY;
    process.env.TEST_READ_ONLY = 'false';
    process.env.NODE_ENV = 'test';
    
    // Initialize test environment
    setupTestEnvironment();
    
    // Initialize test database with schema
    const testDb = initTestDatabase();
    
    // Insert test data
    insertTestData(testDb);
    
    // Close direct connection
    testDb.close();
    
    // Force reload of modules
    jest.resetModules();
    db = require('../../src/db');
    
    console.log('Test database setup complete for grant transaction tests');
    
    // Create a test employee for grant tests
    const employeeModel = require('../../src/models/employee');
    testTransaction = db.transaction();
    
    const employee = {
      tenant_id: 1,
      email: 'grant.test@example.com',
      first_name: 'Grant',
      last_name: 'TestUser',
      status: 'active'
    };
    
    testEmployeeId = await employeeModel.createEmployee(employee, testTransaction);
    testTransaction.commit();
    
    console.log(`Created test employee ID ${testEmployeeId} for grant tests`);
  });
  
  // Start a transaction before each test
  beforeEach(() => {
    testTransaction = db.transaction();
  });
  
  // Roll back transaction after each test
  afterEach(() => {
    if (testTransaction) {
      testTransaction.rollback();
    }
  });
  
  // Clean up test database after all tests
  afterAll(() => {
    cleanupTestDatabase();
  });
  
  // Write operation tests
  test('should create a new grant', async () => {
    const now = new Date();
    const grantDate = dateUtils.formatDate(now);
    const vestingStart = dateUtils.formatDate(now);
    
    const newGrant = {
      employee_id: testEmployeeId,
      grant_date: grantDate,
      vesting_start_date: vestingStart,
      shares_granted: 1000,
      vesting_schedule_id: 1, // Assuming a default vesting schedule exists
      status: 'active'
    };
    
    const grantId = await grantModel.createGrant(newGrant, testTransaction);
    
    expect(grantId).toBeGreaterThan(0);
    
    // Verify grant was created
    const grant = await grantModel.getGrantById(grantId, testTransaction);
    expect(grant).toBeDefined();
    expect(grant.employee_id).toBe(newGrant.employee_id);
    expect(grant.shares_granted).toBe(newGrant.shares_granted);
    expect(grant.status).toBe(newGrant.status);
  });
  
  test('should update a grant', async () => {
    // First create a test grant
    const now = new Date();
    const grantDate = dateUtils.formatDate(now);
    const vestingStart = dateUtils.formatDate(now);
    
    const newGrant = {
      employee_id: testEmployeeId,
      grant_date: grantDate,
      vesting_start_date: vestingStart,
      shares_granted: 1000,
      vesting_schedule_id: 1,
      status: 'active'
    };
    
    const grantId = await grantModel.createGrant(newGrant, testTransaction);
    
    // Update the grant
    const updates = {
      shares_granted: 1500,
      status: 'amended'
    };
    
    await grantModel.updateGrant(grantId, updates, testTransaction);
    
    // Verify updates
    const updatedGrant = await grantModel.getGrantById(grantId, testTransaction);
    expect(updatedGrant.shares_granted).toBe(updates.shares_granted);
    expect(updatedGrant.status).toBe(updates.status);
    
    // Verify other fields weren't changed
    expect(updatedGrant.employee_id).toBe(newGrant.employee_id);
    expect(updatedGrant.grant_date).toBe(newGrant.grant_date);
  });
  
  test('should cancel a grant', async () => {
    // First create a test grant
    const now = new Date();
    const grantDate = dateUtils.formatDate(now);
    const vestingStart = dateUtils.formatDate(now);
    
    const newGrant = {
      employee_id: testEmployeeId,
      grant_date: grantDate,
      vesting_start_date: vestingStart,
      shares_granted: 1000,
      vesting_schedule_id: 1,
      status: 'active'
    };
    
    const grantId = await grantModel.createGrant(newGrant, testTransaction);
    
    // Cancel the grant
    await grantModel.cancelGrant(grantId, testTransaction);
    
    // Verify grant was cancelled
    const cancelledGrant = await grantModel.getGrantById(grantId, testTransaction);
    expect(cancelledGrant.status).toBe('cancelled');
  });
  
  test('should create vesting records for a grant', async () => {
    // First create a test grant
    const now = new Date();
    const grantDate = dateUtils.formatDate(now);
    const vestingStart = dateUtils.formatDate(now);
    
    const newGrant = {
      employee_id: testEmployeeId,
      grant_date: grantDate,
      vesting_start_date: vestingStart,
      shares_granted: 1000,
      vesting_schedule_id: 1, // Assuming a 4-year monthly vesting schedule
      status: 'active'
    };
    
    const grantId = await grantModel.createGrant(newGrant, testTransaction);
    
    // Generate vesting records
    await grantModel.generateVestingRecords(grantId, testTransaction);
    
    // Verify vesting records were created
    const vestingRecords = await grantModel.getVestingRecordsByGrantId(grantId, testTransaction);
    expect(Array.isArray(vestingRecords)).toBe(true);
    expect(vestingRecords.length).toBeGreaterThan(0);
    
    // Verify the total vesting amount matches the grant amount
    let totalVested = 0;
    vestingRecords.forEach(record => {
      totalVested += record.vested_amount;
    });
    
    expect(totalVested).toBe(newGrant.shares_granted);
  });
  
  test('should handle batch grant creation', async () => {
    // Create multiple grants in batch
    const now = new Date();
    const grantDate = dateUtils.formatDate(now);
    const vestingStart = dateUtils.formatDate(now);
    
    const batch = [
      {
        employee_id: testEmployeeId,
        grant_date: grantDate,
        vesting_start_date: vestingStart,
        shares_granted: 500,
        vesting_schedule_id: 1,
        status: 'active'
      },
      {
        employee_id: testEmployeeId,
        grant_date: grantDate,
        vesting_start_date: vestingStart,
        shares_granted: 750,
        vesting_schedule_id: 1,
        status: 'active'
      }
    ];
    
    // Assuming there's a createGrants batch function
    const results = await grantModel.createGrants(batch, testTransaction);
    
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(batch.length);
    
    // Verify all were created
    for (let i = 0; i < results.length; i++) {
      const grant = await grantModel.getGrantById(results[i], testTransaction);
      expect(grant).toBeDefined();
      expect(grant.shares_granted).toBe(batch[i].shares_granted);
    }
  });
  
  test('should calculate future vesting correctly', async () => {
    // Create a grant with future vesting
    const now = new Date();
    const futureDate = dateUtils.addYears(now, 1); // 1 year in the future
    
    const grantDate = dateUtils.formatDate(now);
    const vestingStart = dateUtils.formatDate(now);
    
    const newGrant = {
      employee_id: testEmployeeId,
      grant_date: grantDate,
      vesting_start_date: vestingStart,
      shares_granted: 1000,
      vesting_schedule_id: 1, // Assuming a 4-year monthly vesting schedule
      status: 'active'
    };
    
    const grantId = await grantModel.createGrant(newGrant, testTransaction);
    
    // Generate vesting records
    await grantModel.generateVestingRecords(grantId, testTransaction);
    
    // Calculate future vesting
    const vestingForecast = await grantModel.calculateFutureVesting(grantId, futureDate, testTransaction);
    
    expect(vestingForecast).toBeDefined();
    expect(vestingForecast.vested_amount).toBeGreaterThan(0);
    expect(vestingForecast.vested_amount).toBeLessThanOrEqual(newGrant.shares_granted);
    
    // For a 1-year future date with 4-year vesting, expect approximately 25%
    const expectedVested = newGrant.shares_granted * 0.25;
    const tolerance = newGrant.shares_granted * 0.05; // Allow 5% tolerance
    
    expect(vestingForecast.vested_amount).toBeGreaterThanOrEqual(expectedVested - tolerance);
    expect(vestingForecast.vested_amount).toBeLessThanOrEqual(expectedVested + tolerance);
  });
}); 