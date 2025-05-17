/**
 * Read-only Database Tests
 * 
 * These tests verify the database connectivity and basic query functionality
 * without modifying any data. They're designed to be completely safe to run
 * against any database.
 */

const { setupTestEnvironment, initTestDatabase, insertTestData, cleanupTestDatabase } = require('../utils/test-setup');
const db = require('../../src/db');

describe('Read-only Database Tests', () => {
  // Global database connection
  let testDb;
  
  // Set up test environment before any tests run
  beforeAll(() => {
    // Set read-only mode flag
    process.env.TEST_READ_ONLY = 'true';
    
    // Setup test environment
    setupTestEnvironment();
    
    // Initialize test database
    testDb = initTestDatabase();
    
    // Insert test data
    insertTestData(testDb);
    
    // Close the direct connection (we'll use the db module for tests)
    testDb.close();
    
    console.log('Test database setup complete. Ready for read-only tests.');
  });
  
  // Clean up after all tests
  afterAll(() => {
    // Close database connection
    db.close();
    
    // Reset read-only flag
    delete process.env.TEST_READ_ONLY;
    
    // Clean up test database if needed
    cleanupTestDatabase();
  });
  
  // Basic connectivity test
  test('should connect to database', () => {
    // Simple query to check connection
    const result = db.get('SELECT sqlite_version() as version');
    
    // Verify we got a result
    expect(result).toBeDefined();
    expect(result.version).toBeDefined();
    
    console.log(`Connected to SQLite version: ${result.version}`);
  });
  
  // Test basic query functions
  test('should retrieve tenant data', () => {
    const tenant = db.get('SELECT * FROM tenant WHERE tenant_id = ?', [1]);
    
    expect(tenant).toBeDefined();
    expect(tenant.tenant_id).toBe(1);
    expect(tenant.name).toBe('Test Company');
  });
  
  test('should retrieve multiple rows', () => {
    const ppsHistory = db.all('SELECT * FROM pps_history ORDER BY effective_date');
    
    expect(Array.isArray(ppsHistory)).toBe(true);
    expect(ppsHistory.length).toBeGreaterThanOrEqual(3);
    
    // Verify data is correct
    expect(ppsHistory[0].price_per_share).toBe(1);
    expect(ppsHistory[1].price_per_share).toBe(1.5);
    expect(ppsHistory[2].price_per_share).toBe(2);
  });
  
  test('should handle empty results', () => {
    const result = db.all(
      'SELECT * FROM employee WHERE email = ?', 
      ['nonexistent@test.com']
    );
    
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
  
  test('should handle query parameters correctly', () => {
    const parameters = ['admin@test.com', 'admin'];
    
    const user = db.get(
      'SELECT * FROM user WHERE email = ? AND role = ?',
      parameters
    );
    
    expect(user).toBeDefined();
    expect(user.email).toBe('admin@test.com');
    expect(user.role).toBe('admin');
  });
  
  test('should throw error when trying to modify data in read-only mode', () => {
    expect(() => {
      db.run('INSERT INTO tenant (name) VALUES (?)', ['Test Insert']);
    }).toThrow(/TEST_READ_ONLY mode/);
  });
  
  test('should throw error when trying to use transactions in read-only mode', () => {
    expect(() => {
      db.transaction((client) => {
        return client.get('SELECT 1 as value');
      });
    }).toThrow(/TEST_READ_ONLY mode/);
  });
}); 