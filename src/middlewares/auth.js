/**
 * Authentication middleware for the RSU/ESOP Platform.
 * Handles user authentication and role-based access control.
 */

/**
 * Middleware to check if user is authenticated (admin only)
 * Only allows access if req.session.user is set. Never check both user and employee at once.
 */
function isAuthenticated(req, res, next) {
  // Best practice: never allow both req.session.user and req.session.employee to be set at the same time
  if (req.session && req.session.user && !req.session.employee) {
    return next();
  } else {
    return res.redirect('/auth/login');
  }
}

/**
 * Middleware to check if user has admin role
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function isAdmin(req, res, next) {
  console.log('[AUTH] isAdmin middleware hit');
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    console.log('[AUTH] User is admin:', req.session.user.email);
    return next();
  } else {
    console.warn('[AUTH] User is NOT admin. Access denied. User:', req.session && req.session.user);
    return res.status(403).render('error', {
      message: 'Forbidden',
      error: { status: 403, stack: 'Admin access required.' }
    });
  }
}

/**
 * Middleware to check if user is an employee (self) or admin
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function isEmployeeOrAdmin(req, res, next) {
  console.log('[AUTH] isEmployeeOrAdmin middleware hit');
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    console.log('[AUTH] User is admin:', req.session.user.email);
    return next();
  }
  if (req.session && req.session.user && req.session.user.role === 'employee') {
    const routeEmployeeUid = req.params.employee_uid;
    const userEmployeeUid = req.session.user.employee_uid;
    console.log('[AUTH] Employee check:', { routeEmployeeUid, userEmployeeUid });
    if (routeEmployeeUid && userEmployeeUid && routeEmployeeUid === userEmployeeUid) {
      console.log('[AUTH] User is the employee themselves. Access granted.');
      return next();
    }
  }
  console.warn('[AUTH] User is NOT authorized as employee or admin. Access denied. User:', req.session && req.session.user);
  return res.status(403).render('error', {
    message: 'Forbidden',
    error: { status: 403, stack: 'Employee or admin access required.' }
  });
}

/**
 * Middleware to set the current tenant ID from session
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function setTenantId(req, res, next) {
  if (req.session && req.session.user) {
    req.tenantUid = req.session.user.tenant_uid;
  }
  next();
}

/**
 * Create HTTP-only secure cookies
 * @param {Object} res - Express response object
 * @param {string} name - Cookie name
 * @param {string} value - Cookie value
 * @param {Object} options - Cookie options
 */
function setSecureCookie(res, name, value, options = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Set default cookie options
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    ...options
  };
  
  // Set the cookie
  res.cookie(name, value, cookieOptions);
}

/**
 * Middleware to check if employee is authenticated (employee only)
 * Only allows access if req.session.employee is set. Never check both user and employee at the same time.
 */
function isEmployeeAuthenticated(req, res, next) {
  // Best practice: never allow both req.session.user and req.session.employee to be set at the same time
  if (req.session && req.session.employee && !req.session.user) {
    return next();
  } else {
    return res.redirect('/auth/employee-login');
  }
}

module.exports = {
  isAuthenticated,
  isAdmin,
  isEmployeeOrAdmin,
  setTenantId,
  setSecureCookie,
  isEmployeeAuthenticated
}; 