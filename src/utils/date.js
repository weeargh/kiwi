/**
 * Date and timezone utility for the RSU/ESOP Platform.
 * Handles tenant-specific date conversions, calculations, and formatting.
 */

const { DateTime, Interval } = require('luxon');

/**
 * Convert a date to a specific timezone
 * @param {string|Date} date - Date to convert
 * @param {string} timezone - IANA timezone identifier (e.g., 'America/New_York')
 * @returns {DateTime} - Luxon DateTime object in the specified timezone
 */
function toTenantTimezone(date, timezone) {
  if (!date) return null;
  
  // Handle different input formats
  let dt;
  if (date instanceof Date) {
    dt = DateTime.fromJSDate(date);
  } else if (typeof date === 'string') {
    // Try ISO format first
    dt = DateTime.fromISO(date);
    if (!dt.isValid) {
      // Try SQL date format
      dt = DateTime.fromSQL(date);
    }
  } else if (date instanceof DateTime) {
    dt = date;
  } else {
    throw new Error('Invalid date format');
  }
  
  // Set the timezone
  return dt.setZone(timezone);
}

/**
 * Get the current date in tenant timezone
 * @param {string} timezone - IANA timezone identifier
 * @returns {DateTime} - Current date in tenant timezone
 */
function getCurrentDateInTenantTimezone(timezone) {
  return DateTime.now().setZone(timezone);
}

/**
 * Format a date for display
 * @param {string|Date} date - Date to format
 * @param {string} timezone - Tenant timezone
 * @param {string} format - Format string (defaults to 'yyyy-MM-dd')
 * @returns {string} - Formatted date string
 */
function formatDate(date, timezone, format = 'yyyy-MM-dd') {
  if (!date) return '';
  const dt = toTenantTimezone(date, timezone);
  return dt.toFormat(format);
}

/**
 * Calculate the vest date applying month-end rule
 * - If original day exceeds days in target month, use last day of that month
 * - Special handling for leap years (Feb 29)
 * 
 * @param {Date|string} grantDate - Original grant date
 * @param {number} monthsToAdd - Number of months to add for vesting
 * @param {string} timezone - Tenant timezone
 * @returns {DateTime} - Calculated vest date as Luxon DateTime
 */
function calculateVestDate(grantDate, monthsToAdd, timezone) {
  // Convert to DateTime in tenant timezone
  const dt = toTenantTimezone(grantDate, timezone);
  
  // Get the original day of month
  const originalDay = dt.day;
  
  // Add the specified number of months
  const targetMonth = dt.plus({ months: monthsToAdd });
  
  // Get days in the target month
  const daysInTargetMonth = targetMonth.daysInMonth;
  
  // Apply month-end rule: use min(original_day, days_in_month)
  const adjustedDay = Math.min(originalDay, daysInTargetMonth);
  
  // Return date with the adjusted day
  return targetMonth.set({ day: adjustedDay });
}

/**
 * Calculate all vest dates for a grant (48 months)
 * @param {Date|string} grantDate - Grant date
 * @param {string} timezone - Tenant timezone
 * @returns {Array<DateTime>} - Array of 48 vest dates as Luxon DateTime objects
 */
function calculateAllVestDates(grantDate, timezone) {
  const vestDates = [];
  
  // For each of the 48 months
  for (let i = 1; i <= 48; i++) {
    vestDates.push(calculateVestDate(grantDate, i, timezone));
  }
  
  return vestDates;
}

/**
 * Check if a vest date has passed in tenant timezone
 * @param {Date|string} vestDate - Vest date to check
 * @param {string} timezone - Tenant timezone
 * @returns {boolean} - True if vest date has passed
 */
function hasVestDatePassed(vestDate, timezone) {
  const now = getCurrentDateInTenantTimezone(timezone);
  const vest = toTenantTimezone(vestDate, timezone);
  
  // Compare dates (ignoring time)
  return now.startOf('day') >= vest.startOf('day');
}

/**
 * Calculate the number of months between two dates
 * @param {Date|string} startDate - Start date
 * @param {Date|string} endDate - End date
 * @param {string} timezone - Tenant timezone
 * @returns {number} - Number of whole months between dates
 */
function monthsBetween(startDate, endDate, timezone) {
  const start = toTenantTimezone(startDate, timezone);
  const end = toTenantTimezone(endDate, timezone);
  
  // Calculate months difference
  const years = end.year - start.year;
  const months = end.month - start.month;
  
  // Calculate day difference considering month endings
  const dayAdjustment = end.day >= start.day ? 0 : -1;
  
  return years * 12 + months + dayAdjustment;
}

/**
 * Convert a date string to SQL format for database storage
 * @param {Date|string} date - Date to convert
 * @returns {string} - Date in SQL format (YYYY-MM-DD)
 */
function toSqlDate(date) {
  if (!date) return null;
  
  let dt;
  if (date instanceof Date) {
    dt = DateTime.fromJSDate(date);
  } else if (typeof date === 'string') {
    dt = DateTime.fromISO(date);
  } else if (date instanceof DateTime) {
    dt = date;
  } else {
    throw new Error('Invalid date format');
  }
  
  return dt.toFormat('yyyy-MM-dd');
}

/**
 * Get the current date as ISO string (YYYY-MM-DD) in tenant timezone
 * @param {string} timezone - IANA timezone identifier
 * @returns {string} - Current date as ISO string
 */
function getCurrentDate(timezone) {
  return getCurrentDateInTenantTimezone(timezone).toISODate();
}

/**
 * Parse a date string into a Luxon DateTime object
 * @param {string|Date} date - Date to parse
 * @param {string} timezone - Tenant timezone
 * @returns {DateTime} - Parsed date as Luxon DateTime
 */
function parseDate(date, timezone) {
  return toTenantTimezone(date, timezone);
}

module.exports = {
  toTenantTimezone,
  getCurrentDateInTenantTimezone,
  formatDate,
  calculateVestDate,
  calculateAllVestDates,
  hasVestDatePassed,
  monthsBetween,
  toSqlDate,
  getCurrentDate,
  parseDate
}; 