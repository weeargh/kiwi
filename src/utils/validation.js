/**
 * Validation utility for the RSU/ESOP Platform.
 * Provides input validation and error handling functions.
 */

const decimal = require('./decimal');

/**
 * Validate an email address
 * @param {string} email - Email address to validate
 * @returns {boolean} - True if valid
 */
function isValidEmail(email) {
  if (!email) return false;
  
  // Basic RFC 5322 compliant regex
  const emailRegex = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return emailRegex.test(String(email).toLowerCase());
}

/**
 * Validate a password meets requirements
 * @param {string} password - Password to validate
 * @returns {Object} - Validation result: { valid: boolean, message: string }
 */
function validatePassword(password) {
  if (!password) {
    return { valid: false, message: 'Password is required' };
  }
  
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }
  
  // Check for at least one uppercase letter
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }
  
  // Check for at least one lowercase letter
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }
  
  // Check for at least one digit
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' };
  }
  
  return { valid: true, message: 'Password is valid' };
}

/**
 * Validate a number is positive
 * @param {number} value - Number to validate
 * @returns {boolean} - True if valid
 */
function isPositive(value) {
  return typeof value === 'number' && value > 0;
}

/**
 * Validate a number is non-negative
 * @param {number} value - Number to validate
 * @returns {boolean} - True if valid
 */
function isNonNegative(value) {
  return typeof value === 'number' && value >= 0;
}

/**
 * Validate a date string is in valid format (YYYY-MM-DD)
 * @param {string} dateStr - Date string to validate
 * @returns {boolean} - True if valid
 */
function isValidDateFormat(dateStr) {
  if (!dateStr) return false;
  
  // Check format YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) return false;
  
  // Check if it's a valid date
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Validate a tenant currency code (ISO 4217)
 * @param {string} currency - Currency code to validate
 * @returns {boolean} - True if valid
 */
function isValidCurrencyCode(currency) {
  if (!currency) return false;
  
  // Must be exactly 3 uppercase letters
  const currencyRegex = /^[A-Z]{3}$/;
  return currencyRegex.test(currency);
}

/**
 * Validate a timezone identifier (IANA)
 * @param {string} timezone - Timezone identifier to validate
 * @returns {boolean} - True if valid
 */
function isValidTimezone(timezone) {
  if (!timezone) return false;
  
  try {
    // Try to create a date with this timezone
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Validate a user role
 * @param {string} role - Role to validate
 * @returns {boolean} - True if valid
 */
function isValidRole(role) {
  return ['admin', 'employee'].includes(role);
}

/**
 * Validate a status value
 * @param {string} status - Status to validate
 * @returns {boolean} - True if valid
 */
function isValidStatus(status) {
  return ['active', 'inactive'].includes(status);
}

/**
 * Validate a pool event type
 * @param {string} eventType - Event type to validate
 * @returns {boolean} - True if valid
 */
function isValidPoolEventType(eventType) {
  return ['initial', 'top_up', 'reduction'].includes(eventType);
}

/**
 * Validate form input against a validation schema
 * @param {Object} data - Input data to validate
 * @param {Object} schema - Validation schema
 * @returns {Object} - Validation result: { valid: boolean, errors: Object }
 */
function validateForm(data, schema) {
  const errors = {};
  let valid = true;
  
  for (const field in schema) {
    const rules = schema[field];
    const value = data[field];
    
    // Required check
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors[field] = `${rules.label || field} is required`;
      valid = false;
      continue;
    }
    
    // Skip other validations if value is empty and not required
    if (value === undefined || value === null || value === '') {
      continue;
    }
    
    // Type validations
    if (rules.type === 'email' && !isValidEmail(value)) {
      errors[field] = `${rules.label || field} must be a valid email address`;
      valid = false;
    } else if (rules.type === 'password') {
      const passwordResult = validatePassword(value);
      if (!passwordResult.valid) {
        errors[field] = passwordResult.message;
        valid = false;
      }
    } else if (rules.type === 'number') {
      const numValue = Number(value);
      if (isNaN(numValue)) {
        errors[field] = `${rules.label || field} must be a number`;
        valid = false;
      } else if (rules.positive && !isPositive(numValue)) {
        errors[field] = `${rules.label || field} must be positive`;
        valid = false;
      } else if (rules.nonNegative && !isNonNegative(numValue)) {
        errors[field] = `${rules.label || field} must be non-negative`;
        valid = false;
      } else if (rules.min !== undefined && numValue < rules.min) {
        errors[field] = `${rules.label || field} must be at least ${rules.min}`;
        valid = false;
      } else if (rules.max !== undefined && numValue > rules.max) {
        errors[field] = `${rules.label || field} must be at most ${rules.max}`;
        valid = false;
      } else if (rules.decimalPlaces && !decimal.validateDecimalPrecision(value)) {
        errors[field] = `${rules.label || field} must have at most ${decimal.DECIMAL_PLACES} decimal places`;
        valid = false;
      }
    } else if (rules.type === 'date' && !isValidDateFormat(value)) {
      errors[field] = `${rules.label || field} must be a valid date in YYYY-MM-DD format`;
      valid = false;
    } else if (rules.type === 'currency' && !isValidCurrencyCode(value)) {
      errors[field] = `${rules.label || field} must be a valid currency code (ISO 4217)`;
      valid = false;
    } else if (rules.type === 'timezone' && !isValidTimezone(value)) {
      errors[field] = `${rules.label || field} must be a valid timezone identifier`;
      valid = false;
    } else if (rules.type === 'role' && !isValidRole(value)) {
      errors[field] = `${rules.label || field} must be either 'admin' or 'employee'`;
      valid = false;
    } else if (rules.type === 'status' && !isValidStatus(value)) {
      errors[field] = `${rules.label || field} must be either 'active' or 'inactive'`;
      valid = false;
    } else if (rules.type === 'poolEventType' && !isValidPoolEventType(value)) {
      errors[field] = `${rules.label || field} must be one of: 'initial', 'top_up', 'reduction'`;
      valid = false;
    }
    
    // Length validations
    if (rules.minLength && value.length < rules.minLength) {
      errors[field] = `${rules.label || field} must be at least ${rules.minLength} characters`;
      valid = false;
    } else if (rules.maxLength && value.length > rules.maxLength) {
      errors[field] = `${rules.label || field} must be at most ${rules.maxLength} characters`;
      valid = false;
    }
    
    // Custom validation
    if (rules.validate && typeof rules.validate === 'function') {
      const customResult = rules.validate(value, data);
      if (customResult !== true) {
        errors[field] = customResult;
        valid = false;
      }
    }
  }
  
  return { valid, errors };
}

/**
 * Format validation errors for API response
 * @param {Object} errors - Validation errors object
 * @returns {Object} - Formatted API error response
 */
function formatErrorResponse(errors) {
  return {
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: errors
    }
  };
}

module.exports = {
  isValidEmail,
  validatePassword,
  isPositive,
  isNonNegative,
  isValidDateFormat,
  isValidCurrencyCode,
  isValidTimezone,
  isValidRole,
  isValidStatus,
  isValidPoolEventType,
  validateForm,
  formatErrorResponse
}; 