/**
 * Tests for the date utility functions
 */

const dateUtils = require('../../src/utils/date');
const { DateTime } = require('luxon');

describe('Date Utility Tests', () => {
  // Default timezone for tests
  const TEST_TIMEZONE = 'UTC';
  
  // Test date parsing
  test('should parse various date formats correctly', () => {
    // Standard ISO format
    expect(dateUtils.parseDate('2023-01-15', TEST_TIMEZONE).toISODate()).toBe('2023-01-15');
    
    // Date object
    const testDate = new Date('2023-01-15T00:00:00Z');
    expect(dateUtils.parseDate(testDate, TEST_TIMEZONE).toISODate()).toBe('2023-01-15');
    
    // SQL date format
    expect(dateUtils.parseDate('2023-01-15 00:00:00', TEST_TIMEZONE).toISODate()).toBe('2023-01-15');
    
    // With time component
    expect(dateUtils.parseDate('2023-01-15T10:30:00Z', TEST_TIMEZONE).day).toBe(15);
    expect(dateUtils.parseDate('2023-01-15T10:30:00Z', TEST_TIMEZONE).hour).toBe(10);
    
    // Invalid dates should throw
    expect(() => dateUtils.parseDate('not-a-date', TEST_TIMEZONE)).toThrow();
  });

  // Test date formatting
  test('should format dates correctly', () => {
    const testDate = new Date('2023-01-15T00:00:00Z');
    
    // Default format (YYYY-MM-DD)
    expect(dateUtils.formatDate(testDate, TEST_TIMEZONE)).toBe('2023-01-15');
    
    // Custom formats
    expect(dateUtils.formatDate(testDate, TEST_TIMEZONE, 'MM/dd/yyyy')).toBe('01/15/2023');
    expect(dateUtils.formatDate(testDate, TEST_TIMEZONE, 'dd/MM/yyyy')).toBe('15/01/2023');
    expect(dateUtils.formatDate(testDate, TEST_TIMEZONE, 'MMM d, yyyy')).toBe('Jan 15, 2023');
    
    // With time component
    const testDateTime = new Date('2023-01-15T10:30:45Z');
    expect(dateUtils.formatDate(testDateTime, TEST_TIMEZONE, 'yyyy-MM-dd HH:mm:ss')).toBe('2023-01-15 10:30:45');
  });

  // Test vest date calculations
  test('should calculate vest dates correctly', () => {
    const grantDate = new Date('2023-01-15T00:00:00Z');
    
    // Test 1-month vesting
    const oneMonth = dateUtils.calculateVestDate(grantDate, 1, TEST_TIMEZONE);
    expect(oneMonth.toISODate()).toBe('2023-02-15');
    
    // Test month-end rule (Jan 31 + 1 month = Feb 28/29)
    const janEnd = new Date('2023-01-31T00:00:00Z');
    const febVest = dateUtils.calculateVestDate(janEnd, 1, TEST_TIMEZONE);
    expect(febVest.toISODate()).toBe('2023-02-28');
    
    // Test leap year (Jan 31, 2024 + 1 month = Feb 29, 2024)
    const jan2024End = new Date('2024-01-31T00:00:00Z');
    const feb2024Vest = dateUtils.calculateVestDate(jan2024End, 1, TEST_TIMEZONE);
    expect(feb2024Vest.toISODate()).toBe('2024-02-29');
  });
  
  // Test calculating all vest dates
  test('should calculate all vest dates for a grant', () => {
    const grantDate = new Date('2023-01-15T00:00:00Z');
    const vestDates = dateUtils.calculateAllVestDates(grantDate, TEST_TIMEZONE);
    
    // Should return 48 dates
    expect(vestDates.length).toBe(48);
    
    // First vest should be one month after grant
    expect(vestDates[0].toISODate()).toBe('2023-02-15');
    
    // Last vest should be 48 months after grant
    expect(vestDates[47].toISODate()).toBe('2027-01-15');
  });
  
  // Test months between calculation
  test('should calculate months between dates correctly', () => {
    const start = new Date('2023-01-15T00:00:00Z');
    const oneMonthLater = new Date('2023-02-15T00:00:00Z');
    const oneYearLater = new Date('2024-01-15T00:00:00Z');
    
    expect(dateUtils.monthsBetween(start, oneMonthLater, TEST_TIMEZONE)).toBe(1);
    expect(dateUtils.monthsBetween(start, oneYearLater, TEST_TIMEZONE)).toBe(12);
    
    // Test partial months (should return whole months)
    const partialMonth = new Date('2023-02-10T00:00:00Z'); // 5 days before full month
    expect(dateUtils.monthsBetween(start, partialMonth, TEST_TIMEZONE)).toBe(0);
    
    // Test when day of end date is after day of start date
    const endDayLater = new Date('2023-02-20T00:00:00Z');
    expect(dateUtils.monthsBetween(start, endDayLater, TEST_TIMEZONE)).toBe(1);
  });
  
  // Test SQL date conversion
  test('should convert dates to SQL format', () => {
    const jsDate = new Date('2023-01-15T10:30:45Z');
    expect(dateUtils.toSqlDate(jsDate)).toBe('2023-01-15');
    
    // String input
    expect(dateUtils.toSqlDate('2023-01-15T10:30:45Z')).toBe('2023-01-15');
    
    // Null handling
    expect(dateUtils.toSqlDate(null)).toBeNull();
  });
  
  // Test has vest date passed function
  test('should check if vest date has passed', () => {
    // Mock the current date to be 2023-07-01
    const realNow = DateTime.now;
    DateTime.now = jest.fn(() => DateTime.fromISO('2023-07-01T12:00:00Z'));
    
    // Past date
    const pastDate = new Date('2023-06-01T00:00:00Z');
    expect(dateUtils.hasVestDatePassed(pastDate, TEST_TIMEZONE)).toBe(true);
    
    // Future date
    const futureDate = new Date('2023-08-01T00:00:00Z');
    expect(dateUtils.hasVestDatePassed(futureDate, TEST_TIMEZONE)).toBe(false);
    
    // Same day (should return true)
    const today = new Date('2023-07-01T00:00:00Z');
    expect(dateUtils.hasVestDatePassed(today, TEST_TIMEZONE)).toBe(true);
    
    // Restore the original now function
    DateTime.now = realNow;
  });
  
  // Test timezone conversion
  test('should convert dates between timezones', () => {
    const utcDate = new Date('2023-01-15T12:00:00Z');
    
    // UTC to New York (should be 5 hours behind in winter)
    const nyDate = dateUtils.toTenantTimezone(utcDate, 'America/New_York');
    expect(nyDate.hour).toBe(7); // 12 UTC = 7 EST
    
    // UTC to Tokyo (should be 9 hours ahead)
    const tokyoDate = dateUtils.toTenantTimezone(utcDate, 'Asia/Tokyo');
    expect(tokyoDate.hour).toBe(21); // 12 UTC = 21 JST
  });
  
  // Test getting current date
  test('should get current date in tenant timezone', () => {
    // Mock DateTime.now()
    const realNow = DateTime.now;
    DateTime.now = jest.fn(() => DateTime.fromISO('2023-07-01T23:30:00Z'));
    
    // In UTC timezone
    expect(dateUtils.getCurrentDate(TEST_TIMEZONE)).toBe('2023-07-01');
    
    // In a timezone with positive offset (Tokyo)
    expect(dateUtils.getCurrentDate('Asia/Tokyo')).toBe('2023-07-02'); // It's already next day in Tokyo
    
    // Restore original now
    DateTime.now = realNow;
  });
}); 