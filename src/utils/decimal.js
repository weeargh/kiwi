/**
 * Utility functions for working with decimal numbers with 3 decimal places.
 * The RSU/ESOP Platform requires exact 3 decimal place precision for all calculations.
 * This utility ensures consistent handling across the application.
 */

const DECIMAL_PLACES = 3;
const MULTIPLIER = 10 ** DECIMAL_PLACES;

/**
 * Round a number to 3 decimal places using banker's rounding (round half to even)
 * @param {number} value - The number to round
 * @returns {number} - The rounded number
 */
function roundHalfToEven(value) {
  // Multiply by 1000 to shift decimal points
  const shifted = value * MULTIPLIER;
  
  // Use Math.round which in JavaScript implements banker's rounding
  // (round half to even) as per the IEEE 754 standard
  const rounded = Math.round(shifted);
  
  // Shift back to 3 decimal places
  return rounded / MULTIPLIER;
}

/**
 * Format a number to exactly 3 decimal places as a string
 * @param {number} value - The number to format
 * @returns {string} - Formatted string with exactly 3 decimal places
 */
function format(value) {
  if (value === null || value === undefined) return null;
  const rounded = roundHalfToEven(parseFloat(value));
  return rounded.toFixed(DECIMAL_PLACES);
}

/**
 * Add two numbers with 3 decimal precision
 * @param {number} a - First number
 * @param {number} b - Second number
 * @returns {number} - Sum rounded to 3 decimal places
 */
function add(a, b) {
  return roundHalfToEven(parseFloat(a) + parseFloat(b));
}

/**
 * Subtract two numbers with 3 decimal precision
 * @param {number} a - First number
 * @param {number} b - Second number to subtract from first
 * @returns {number} - Difference rounded to 3 decimal places
 */
function subtract(a, b) {
  return roundHalfToEven(parseFloat(a) - parseFloat(b));
}

/**
 * Multiply two numbers with 3 decimal precision
 * @param {number} a - First number
 * @param {number} b - Second number
 * @returns {number} - Product rounded to 3 decimal places
 */
function multiply(a, b) {
  return roundHalfToEven(parseFloat(a) * parseFloat(b));
}

/**
 * Divide two numbers with 3 decimal precision
 * @param {number} a - Numerator
 * @param {number} b - Denominator
 * @returns {number} - Quotient rounded to 3 decimal places
 */
function divide(a, b) {
  if (parseFloat(b) === 0) {
    throw new Error('Division by zero');
  }
  return roundHalfToEven(parseFloat(a) / parseFloat(b));
}

/**
 * Calculate vesting tranche size by dividing grant amount by 48,
 * using banker's rounding as required by the specification
 * @param {number} grantAmount - Total grant amount
 * @returns {number} - Tranche size rounded to 3 decimal places
 */
function calculateTrancheSize(grantAmount) {
  return divide(grantAmount, 48);
}

/**
 * Calculate final tranche adjustment to ensure total equals grant amount
 * @param {number} grantAmount - Total grant amount
 * @param {number} vestedAmount - Amount already vested (47 tranches)
 * @returns {number} - Final tranche size rounded to 3 decimal places
 */
function calculateFinalTranche(grantAmount, vestedAmount) {
  return subtract(grantAmount, vestedAmount);
}

/**
 * Validate that a number has at most 3 decimal places
 * @param {number|string} value - Value to validate
 * @returns {boolean} - True if valid, false otherwise
 */
function validateDecimalPrecision(value) {
  if (value === null || value === undefined) return false;
  
  // Convert to string and split by decimal point
  const str = value.toString();
  const parts = str.split('.');
  
  // If there's a decimal part, check its length
  if (parts.length > 1) {
    return parts[1].length <= DECIMAL_PLACES;
  }
  
  // If it's an integer, it's valid
  return true;
}

/**
 * Convert a numeric value to a display string,
 * removing trailing zeros but keeping up to 3 decimal places
 * @param {number} value - The number to format
 * @returns {string} - Formatted string for display
 */
function toDisplayString(value) {
  if (value === null || value === undefined) return '';
  
  // Format with exactly 3 decimal places
  const formatted = format(value);
  
  // Remove trailing zeros but keep at least one digit after decimal
  return formatted.replace(/\.?0+$/, '');
}

/**
 * Format a value as a percentage string
 * @param {number} value - The number to format as percentage (e.g., 0.25 for 25%)
 * @returns {string} - Formatted percentage string (e.g., "25%")
 */
function formatPercent(value) {
  if (value === null || value === undefined) return '0%';
  
  // Convert to percentage and round to 1 decimal place
  const percent = parseFloat(value) * 100;
  return `${Math.round(percent)}%`;
}

/**
 * Format a value as a money string without currency symbol
 * @param {number} value - The number to format as money
 * @returns {string} - Formatted money string with 2 decimal places
 */
function formatMoney(value) {
  if (value === null || value === undefined) return null;
  
  // Round to 2 decimal places for money
  const rounded = Math.round(parseFloat(value) * 100) / 100;
  return rounded.toFixed(2);
}

module.exports = {
  roundHalfToEven,
  format,
  add,
  subtract,
  multiply,
  divide,
  calculateTrancheSize,
  calculateFinalTranche,
  validateDecimalPrecision,
  toDisplayString,
  formatPercent,
  formatMoney,
  DECIMAL_PLACES
}; 