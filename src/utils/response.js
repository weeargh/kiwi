/**
 * Response utility for the RSU/ESOP Platform.
 * Provides consistent API response formatting and error handling.
 */

/**
 * Format a successful API response
 * @param {*} data - Response data
 * @returns {Object} - Formatted success response
 */
function success(data) {
  return {
    success: true,
    data: data || {}
  };
}

/**
 * Format an error API response
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @param {Object} details - Additional error details
 * @returns {Object} - Formatted error response
 */
function error(code, message, details) {
  return {
    success: false,
    error: {
      code: code || 'UNKNOWN_ERROR',
      message: message || 'An unknown error occurred',
      details: details || {}
    }
  };
}

/**
 * Handle common API errors
 * @param {Error} err - Error object
 * @param {Object} res - Express response object
 */
function handleError(err, res) {
  console.error('API Error:', err);
  
  // Default to internal server error
  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let message = 'An internal server error occurred';
  let details = {};
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = err.message || 'Validation failed';
    details = err.details || {};
  } else if (err.name === 'AuthenticationError') {
    statusCode = 401;
    errorCode = 'AUTHENTICATION_ERROR';
    message = err.message || 'Authentication failed';
  } else if (err.name === 'AuthorizationError') {
    statusCode = 403;
    errorCode = 'AUTHORIZATION_ERROR';
    message = err.message || 'Not authorized';
  } else if (err.name === 'NotFoundError') {
    statusCode = 404;
    errorCode = 'NOT_FOUND';
    message = err.message || 'Resource not found';
  } else if (err.name === 'ConflictError') {
    statusCode = 409;
    errorCode = 'CONFLICT';
    message = err.message || 'Resource conflict';
  } else if (err.name === 'DatabaseError') {
    // Map database errors to appropriate responses
    if (err.code === 'SQLITE_CONSTRAINT') {
      statusCode = 409;
      errorCode = 'CONSTRAINT_ERROR';
      message = 'Database constraint violation';
    }
  }
  
  // Send the error response
  res.status(statusCode).json(error(errorCode, message, details));
}

/**
 * Create a custom error with specific properties
 * @param {string} name - Error name/type
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @param {Object} details - Additional error details
 * @returns {Error} - Custom error object
 */
function createError(name, message, statusCode, details) {
  const err = new Error(message);
  err.name = name;
  err.statusCode = statusCode;
  err.details = details;
  return err;
}

/**
 * Create a validation error
 * @param {string} message - Error message
 * @param {Object} details - Validation error details
 * @returns {Error} - Validation error
 */
function validationError(message, details) {
  return createError('ValidationError', message || 'Validation failed', 400, details);
}

/**
 * Create an authentication error
 * @param {string} message - Error message
 * @returns {Error} - Authentication error
 */
function authenticationError(message) {
  return createError('AuthenticationError', message || 'Authentication failed', 401);
}

/**
 * Create an authorization error
 * @param {string} message - Error message
 * @returns {Error} - Authorization error
 */
function authorizationError(message) {
  return createError('AuthorizationError', message || 'Not authorized', 403);
}

/**
 * Create a not found error
 * @param {string} message - Error message
 * @returns {Error} - Not found error
 */
function notFoundError(message) {
  return createError('NotFoundError', message || 'Resource not found', 404);
}

/**
 * Create a conflict error
 * @param {string} message - Error message
 * @returns {Error} - Conflict error
 */
function conflictError(message) {
  return createError('ConflictError', message || 'Resource conflict', 409);
}

/**
 * Create a database error
 * @param {string} message - Error message
 * @param {string} code - Database error code
 * @returns {Error} - Database error
 */
function databaseError(message, code) {
  const err = createError('DatabaseError', message || 'Database error', 500);
  err.code = code;
  return err;
}

/**
 * Format pagination parameters
 * @param {Object} req - Express request object
 * @returns {Object} - Formatted pagination parameters
 */
function getPaginationParams(req) {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  
  // Validate and constrain values
  const validPage = Math.max(1, page);
  const validLimit = Math.min(Math.max(1, limit), 100);
  
  return {
    page: validPage,
    limit: validLimit,
    offset: (validPage - 1) * validLimit
  };
}

/**
 * Format a paginated response
 * @param {Array} items - Result items
 * @param {number} totalItems - Total number of items
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @returns {Object} - Formatted paginated response
 */
function paginatedResponse(items, totalItems, page, limit) {
  const totalPages = Math.ceil(totalItems / limit);
  
  return success({
    items,
    pagination: {
      total_items: totalItems,
      total_pages: totalPages,
      current_page: page,
      limit,
      next_page: page < totalPages ? page + 1 : null,
      prev_page: page > 1 ? page - 1 : null
    }
  });
}

module.exports = {
  success,
  error,
  handleError,
  createError,
  validationError,
  authenticationError,
  authorizationError,
  notFoundError,
  conflictError,
  databaseError,
  getPaginationParams,
  paginatedResponse
}; 