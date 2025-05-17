/**
 * Tests for vesting schedule calculations and edge cases
 */

const dateUtils = require('../../src/utils/date');
const { DateTime } = require('luxon');

describe('Vesting Schedule Edge Case Tests', () => {
  // Default timezone for tests
  const TEST_TIMEZONE = 'UTC';
  
  // Leap year tests
  describe('Leap Year Handling', () => {
    test('should handle January 31 vesting into February in non-leap year', () => {
      // Jan 31, 2023 + 1 month = Feb 28, 2023 (non-leap year)
      const grantDate = new Date('2023-01-31T00:00:00Z');
      const vestDate = dateUtils.calculateVestDate(grantDate, 1, TEST_TIMEZONE);
      expect(vestDate.toISODate()).toBe('2023-02-28');
    });

    test('should handle January 31 vesting into February in leap year', () => {
      // Jan 31, 2024 + 1 month = Feb 29, 2024 (leap year)
      const grantDate = new Date('2024-01-31T00:00:00Z');
      const vestDate = dateUtils.calculateVestDate(grantDate, 1, TEST_TIMEZONE);
      expect(vestDate.toISODate()).toBe('2024-02-29');
    });

    test('should handle February 29 vesting date in subsequent years', () => {
      // Feb 29, 2024 + 1 year = Feb 28, 2025 (non-leap year)
      const grantDate = new Date('2024-02-29T00:00:00Z');
      const vestDate = dateUtils.calculateVestDate(grantDate, 12, TEST_TIMEZONE);
      expect(vestDate.toISODate()).toBe('2025-02-28');

      // Feb 29, 2024 + 2 years = Feb 28, 2026 (non-leap year)
      const vestDate2 = dateUtils.calculateVestDate(grantDate, 24, TEST_TIMEZONE);
      expect(vestDate2.toISODate()).toBe('2026-02-28');
      
      // Feb 29, 2024 + 4 years = Feb 29, 2028 (leap year)
      const vestDate3 = dateUtils.calculateVestDate(grantDate, 48, TEST_TIMEZONE);
      expect(vestDate3.toISODate()).toBe('2028-02-29');
    });
  });

  // Month-end rule tests
  describe('Month-End Rules', () => {
    test('should apply month-end rules consistently', () => {
      // Test different month lengths
      // Jan 31 -> Feb 28/29
      const jan31 = new Date('2023-01-31T00:00:00Z');
      expect(dateUtils.calculateVestDate(jan31, 1, TEST_TIMEZONE).toISODate()).toBe('2023-02-28');
      
      // Mar 31 -> Apr 30
      const mar31 = new Date('2023-03-31T00:00:00Z');
      expect(dateUtils.calculateVestDate(mar31, 1, TEST_TIMEZONE).toISODate()).toBe('2023-04-30');
      
      // Apr 30 -> May 31 (should keep day 30)
      const apr30 = new Date('2023-04-30T00:00:00Z');
      expect(dateUtils.calculateVestDate(apr30, 1, TEST_TIMEZONE).toISODate()).toBe('2023-05-30');
    });

    test('should handle month transitions with different day counts', () => {
      // Test sequence of transitions over multiple months
      const jan31 = new Date('2023-01-31T00:00:00Z');
      
      // Jan 31 -> Feb 28 -> Mar 31 (back to original day)
      const mar31 = dateUtils.calculateVestDate(jan31, 2, TEST_TIMEZONE);
      expect(mar31.toISODate()).toBe('2023-03-31');
      
      // Jan 31 -> Feb 28 -> Mar 31 -> Apr 30
      const apr30 = dateUtils.calculateVestDate(jan31, 3, TEST_TIMEZONE);
      expect(apr30.toISODate()).toBe('2023-04-30');
    });

    test('should handle long sequences of month-end transitions', () => {
      // Test a full year of transitions starting from Jan 31
      const jan31 = new Date('2023-01-31T00:00:00Z');
      const months = [
        '2023-02-28', '2023-03-31', '2023-04-30', '2023-05-31',
        '2023-06-30', '2023-07-31', '2023-08-31', '2023-09-30', 
        '2023-10-31', '2023-11-30', '2023-12-31', '2024-01-31'
      ];
      
      for (let i = 0; i < months.length; i++) {
        const vestDate = dateUtils.calculateVestDate(jan31, i+1, TEST_TIMEZONE);
        expect(vestDate.toISODate()).toBe(months[i]);
      }
    });
  });

  // Test 4-year, 48-month standard vesting schedule
  describe('Standard 48-Month Vesting Schedule', () => {
    test('should calculate all 48 vest dates correctly', () => {
      const grantDate = new Date('2023-01-15T00:00:00Z');
      const vestDates = dateUtils.calculateAllVestDates(grantDate, TEST_TIMEZONE);
      
      // Verify we have 48 dates
      expect(vestDates.length).toBe(48);
      
      // Verify first date is one month after grant
      expect(vestDates[0].toISODate()).toBe('2023-02-15');
      
      // Verify last date is 48 months after grant
      expect(vestDates[47].toISODate()).toBe('2027-01-15');
      
      // Check a few dates in the middle
      expect(vestDates[11].toISODate()).toBe('2024-01-15'); // 1 year
      expect(vestDates[23].toISODate()).toBe('2025-01-15'); // 2 years
      expect(vestDates[35].toISODate()).toBe('2026-01-15'); // 3 years
    });
    
    test('should handle month-end dates in standard vesting schedule', () => {
      // Grant on the last day of a month
      const grantDate = new Date('2023-01-31T00:00:00Z');
      const vestDates = dateUtils.calculateAllVestDates(grantDate, TEST_TIMEZONE);
      
      // Check the month-end handling for the first few months
      expect(vestDates[0].toISODate()).toBe('2023-02-28');
      expect(vestDates[1].toISODate()).toBe('2023-03-31');
      expect(vestDates[2].toISODate()).toBe('2023-04-30');
    });
  });

  // Calculate months between dates tests
  describe('Months Between Calculation', () => {
    test('should calculate partial months correctly', () => {
      const start = new Date('2023-01-15T00:00:00Z');
      
      // Test before full month (should be 0)
      const almostOneMonth = new Date('2023-02-14T00:00:00Z');
      expect(dateUtils.monthsBetween(start, almostOneMonth, TEST_TIMEZONE)).toBe(0);
      
      // Test exactly one month (should be 1)
      const exactlyOneMonth = new Date('2023-02-15T00:00:00Z');
      expect(dateUtils.monthsBetween(start, exactlyOneMonth, TEST_TIMEZONE)).toBe(1);
      
      // Test slightly more than one month (should still be 1)
      const slightlyMoreThanOneMonth = new Date('2023-02-16T00:00:00Z');
      expect(dateUtils.monthsBetween(start, slightlyMoreThanOneMonth, TEST_TIMEZONE)).toBe(1);
    });

    test('should calculate months between dates with different day patterns', () => {
      // Start date on the 31st
      const start = new Date('2023-01-31T00:00:00Z');
      
      // End on the 28th of Feb (should be 0 if using day comparison)
      const feb28 = new Date('2023-02-28T00:00:00Z');
      expect(dateUtils.monthsBetween(start, feb28, TEST_TIMEZONE)).toBe(0);
      
      // End on March 30 (should be 1 - one full month has passed)
      const mar30 = new Date('2023-03-30T00:00:00Z');
      expect(dateUtils.monthsBetween(start, mar30, TEST_TIMEZONE)).toBe(1);
      
      // End on March 31 (should be 2 - full 2 months)
      const mar31 = new Date('2023-03-31T00:00:00Z');
      expect(dateUtils.monthsBetween(start, mar31, TEST_TIMEZONE)).toBe(2);
    });

    test('should calculate months between dates with leap year February', () => {
      // Start Jan 31, 2024 (leap year)
      const start = new Date('2024-01-31T00:00:00Z');
      
      // End Feb 29, 2024 (should be 0 - not a full month by day comparison)
      const feb29 = new Date('2024-02-29T00:00:00Z');
      expect(dateUtils.monthsBetween(start, feb29, TEST_TIMEZONE)).toBe(0);
      
      // End Mar 30, 2024 (should be 1 - one full month)
      const mar30 = new Date('2024-03-30T00:00:00Z');
      expect(dateUtils.monthsBetween(start, mar30, TEST_TIMEZONE)).toBe(1);
    });
  });

  // Vest date passing tests
  describe('Has Vest Date Passed', () => {
    test('should correctly identify if vest date has passed', () => {
      // Mock current date
      const realNow = DateTime.now;
      DateTime.now = jest.fn(() => DateTime.fromISO('2023-07-15T12:00:00Z'));
      
      // Test past date
      const pastDate = new Date('2023-07-14T00:00:00Z');
      expect(dateUtils.hasVestDatePassed(pastDate, TEST_TIMEZONE)).toBe(true);
      
      // Test current date
      const currentDate = new Date('2023-07-15T00:00:00Z');
      expect(dateUtils.hasVestDatePassed(currentDate, TEST_TIMEZONE)).toBe(true);
      
      // Test future date
      const futureDate = new Date('2023-07-16T00:00:00Z');
      expect(dateUtils.hasVestDatePassed(futureDate, TEST_TIMEZONE)).toBe(false);
      
      // Restore original DateTime.now
      DateTime.now = realNow;
    });
  });
}); 