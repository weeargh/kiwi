const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const db = require('../db');
const { isAuthenticated } = require('../middlewares/auth');
const { validationError } = require('../utils/response');
const { validateForm } = require('../utils/validation');
const audit = require('../utils/audit');
const rateLimit = require('express-rate-limit');
const employeeModel = require('../models/employee');
const nodemailer = require('nodemailer');
const { nanoid } = require('nanoid');

// Validation schemas
const loginSchema = {
  email: {
    type: 'email',
    required: true,
    label: 'Email'
  },
  password: {
    type: 'password',
    required: true,
    label: 'Password'
  }
};

const registerSchema = {
  name: {
    type: 'string',
    required: true,
    minLength: 2,
    maxLength: 100,
    label: 'Name'
  },
  email: {
    type: 'email',
    required: true,
    label: 'Email'
  },
  password: {
    type: 'password',
    required: true,
    label: 'Password'
  },
  confirmPassword: {
    type: 'password',
    required: true,
    label: 'Confirm Password',
    validate: (value, data) => {
      return value === data.password || 'Passwords do not match';
    }
  },
  tenantName: {
    type: 'string',
    required: true,
    minLength: 2,
    maxLength: 100,
    label: 'Company Name'
  },
  currency: {
    type: 'currency',
    required: true,
    label: 'Currency'
  },
  timezone: {
    type: 'timezone',
    required: true,
    label: 'Timezone'
  }
};

// Rate limiter for login and register
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: 'Too many attempts, please try again later.'
});

// In-memory store for failed login attempts (MVP only)
const failedLogins = {};
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

function isLockedOut(email) {
  const entry = failedLogins[email];
  console.log('isLockedOut check for', email, 'entry:', entry);
  if (!entry) return false;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) return true;
  return false;
}

function recordFailedLogin(email) {
  if (!failedLogins[email]) failedLogins[email] = { count: 0, lockedUntil: null };
  failedLogins[email].count++;
  console.log('recordFailedLogin for', email, 'count:', failedLogins[email].count);
  if (failedLogins[email].count >= LOCKOUT_THRESHOLD) {
    failedLogins[email].lockedUntil = Date.now() + LOCKOUT_TIME;
    console.log('Account locked for', email, 'until', new Date(failedLogins[email].lockedUntil));
  }
}

function resetFailedLogin(email) {
  if (failedLogins[email]) {
    console.log('resetFailedLogin for', email);
    failedLogins[email] = { count: 0, lockedUntil: null };
  }
}

// GET /auth/login - Render login page
router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  res.render('auth/login', {
    title: 'Login',
    error: req.query.error,
    user: req.session.user || null,
    employee: req.session.employee || null
  });
});

// POST /auth/login - Process login
router.post('/login', authLimiter, (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('POST /auth/login attempt for', email);
    if (isLockedOut(email)) {
      console.log('Account is locked out for', email);
      return res.render('auth/login', {
        title: 'Login',
        error: 'Account locked due to too many failed attempts. Please try again later.',
        values: { email },
        user: req.session.user || null,
        employee: req.session.employee || null
      });
    }
    // Validate input
    const { valid, errors } = validateForm(req.body, loginSchema);
    if (!valid) {
      return res.render('auth/login', {
        title: 'Login',
        error: 'Please correct the errors below',
        errors,
        values: req.body,
        user: req.session.user || null,
        employee: req.session.employee || null
      });
    }

    // Find user by email
    const user = db.get(
      `SELECT 
        u.user_uid, 
        u.tenant_uid, 
        u.email, 
        u.name, 
        u.password_hash, 
        u.role, 
        u.status,
        t.timezone,
        t.currency,
        t.name as tenant_name
      FROM user_account u
      JOIN tenant t ON u.tenant_uid = t.tenant_uid
      WHERE u.email = ? AND u.deleted_at IS NULL`,
      [email]
    );

    if (!user) {
      recordFailedLogin(email);
      return res.render('auth/login', {
        title: 'Login',
        error: 'Invalid email or password',
        values: req.body,
        user: req.session.user || null,
        employee: req.session.employee || null
      });
    }

    // Check if user is active
    if (user.status !== 'active') {
      recordFailedLogin(email);
      return res.render('auth/login', {
        title: 'Login',
        error: 'Your account is inactive. Please contact an administrator.',
        values: { email },
        user: req.session.user || null,
        employee: req.session.employee || null
      });
    }

    // Verify password
    const passwordMatch = bcrypt.compareSync(password, user.password_hash);
    if (!passwordMatch) {
      recordFailedLogin(email);
      return res.render('auth/login', {
        title: 'Login',
        error: 'Invalid email or password',
        values: { email },
        user: req.session.user || null,
        employee: req.session.employee || null
      });
    }

    // Store user in session (excluding password_hash)
    const { password_hash, ...userWithoutPassword } = user;
    req.session.user = userWithoutPassword;
    // Enforce session separation: clear employee session if set
    if (req.session.employee) {
      delete req.session.employee;
    }

    // Log successful login
    audit.logAction(
      user.tenant_uid,
      user.user_uid,
      'USER_LOGIN',
      'user',
      user.user_uid,
      null
    );
    resetFailedLogin(email);
    res.redirect('/');
  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', {
      title: 'Login',
      error: 'An error occurred during login. Please try again.',
      values: req.body,
      user: req.session.user || null,
      employee: req.session.employee || null
    });
  }
});

// GET /auth/register - Render registration page
router.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  res.render('auth/register', {
    title: 'Register',
    timezones: getTimezones(),
    currencies: getCurrencies(),
    user: req.session.user || null,
    employee: req.session.employee || null
  });
});

// POST /auth/register - Process registration
router.post('/register', authLimiter, (req, res) => {
  console.log('POST /auth/register attempt for', req.body.email);
  try {
    // Log received form data (excluding passwords)
    const { name, email, tenantName, currency, timezone } = req.body;
    console.log('[REGISTER] Received:', { name, email, tenantName, currency, timezone });

    // Validate input
    const { valid, errors } = validateForm(req.body, registerSchema);
    console.log('[REGISTER] Validation result:', { valid, errors });
    if (!valid) {
      return res.render('auth/register', {
        title: 'Register',
        error: 'Please correct the errors below',
        errors,
        values: req.body,
        timezones: getTimezones(),
        currencies: getCurrencies(),
        user: req.session.user || null,
        employee: req.session.employee || null
      });
    }

    // Check if email is already registered
    const existingUser = db.get(
      'SELECT email FROM user_account WHERE email = ? AND deleted_at IS NULL',
      [email]
    );
    console.log('[REGISTER] Existing user check:', existingUser);

    if (existingUser) {
      return res.render('auth/register', {
        title: 'Register',
        error: 'Email is already registered',
        errors: { email: 'This email is already registered' },
        values: req.body,
        timezones: getTimezones(),
        currencies: getCurrencies(),
        user: req.session.user || null,
        employee: req.session.employee || null
      });
    }

    // Create tenant and admin account in a transaction
    db.transaction((client) => {
      // Generate tenant UID
      const newTenantUid = nanoid();
      // Create tenant
      client.run(
        'INSERT INTO tenant (tenant_uid, name, currency, timezone) VALUES (?, ?, ?, ?)',
        [newTenantUid, tenantName, currency, timezone]
      );
      console.log('[REGISTER] Tenant created:', newTenantUid);

      // Hash password
      const saltRounds = 12;
      const passwordHash = bcrypt.hashSync(req.body.password, saltRounds);

      // Generate user UID
      const newUserUid = nanoid();
      // Create admin user
      client.run(
        'INSERT INTO user_account (user_uid, tenant_uid, email, name, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [newUserUid, newTenantUid, email, name, passwordHash, 'admin', 'active']
      );
      console.log('[REGISTER] Admin user created:', newUserUid);

      // Generate pool UID
      const newPoolUid = nanoid();
      const initialAmount = 1000000; // 1 million shares
      // Create initial equity pool
      client.run(
        'INSERT INTO equity_pool (pool_uid, tenant_uid, initial_amount, total_pool, created_by) VALUES (?, ?, ?, ?, ?)',
        [newPoolUid, newTenantUid, initialAmount, initialAmount, newUserUid]
      );
      console.log('[REGISTER] Equity pool created:', newPoolUid);

      // Generate event UID
      const newEventUid = nanoid();
      // Record initial pool event
      client.run(
        "INSERT INTO pool_event (event_uid, pool_uid, tenant_uid, amount, event_type, effective_date, created_by) VALUES (?, ?, ?, ?, ?, date('now'), ?)",
        [newEventUid, newPoolUid, newTenantUid, initialAmount, 'initial', newUserUid]
      );
      console.log('[REGISTER] Initial pool event recorded');

      // Generate PPS UID
      const newPpsUid = nanoid();
      // Set initial PPS ($1 per share)
      client.run(
        "INSERT INTO pps_history (pps_uid, tenant_uid, effective_date, price_per_share, created_by) VALUES (?, ?, date('now'), ?, ?)",
        [newPpsUid, newTenantUid, 1.000, newUserUid]
      );
      console.log('[REGISTER] Initial PPS set');

      // Log registration
      audit.logAction(
        newTenantUid,
        newUserUid,
        'USER_REGISTER',
        'user',
        newUserUid,
        {
          after: {
            email,
            name,
            role: 'admin',
            tenant_uid: newTenantUid
          }
        }
      );
      audit.logAction(
        newTenantUid,
        newUserUid,
        'TENANT_CREATE',
        'tenant',
        newTenantUid,
        {
          after: {
            name: tenantName,
            currency,
            timezone
          }
        }
      );
      audit.logAction(
        newTenantUid,
        newUserUid,
        'POOL_CREATE',
        'pool',
        newPoolUid,
        {
          after: {
            initial_amount: initialAmount,
            total_pool: initialAmount
          }
        }
      );
      audit.logAction(
        newTenantUid,
        newUserUid,
        'PPS_CREATE',
        'pps',
        null,
        {
          after: {
            effective_date: new Date().toISOString().split('T')[0],
            price_per_share: 1.000
          }
        }
      );
    });

    // Redirect to login page with success message
    res.redirect('/auth/login?success=1');
  } catch (err) {
    console.error('[REGISTER] Registration error:', err);
    res.render('auth/register', {
      title: 'Register',
      error: 'An error occurred during registration. Please try again.',
      values: req.body,
      timezones: getTimezones(),
      currencies: getCurrencies(),
      user: req.session.user || null,
      employee: req.session.employee || null
    });
  }
});

// GET /auth/logout - Process logout
router.get('/logout', (req, res) => {
  try {
    // Log logout if user is authenticated
    if (req.session.user) {
      audit.logAction(
        req.session.user.tenant_uid,
        req.session.user.user_uid,
        'USER_LOGOUT',
        'user',
        req.session.user.user_uid,
        null
      );
    }
    // Log logout if employee is authenticated
    if (req.session.employee) {
      audit.logAction(
        req.session.employee.tenant_uid,
        req.session.employee.employee_uid,
        'EMPLOYEE_LOGOUT',
        'employee',
        req.session.employee.employee_uid,
        null
      );
    }
    // Destroy the session (clears both user and employee)
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying session:', err);
      }
      res.redirect('/auth/login');
    });
  } catch (err) {
    console.error('Logout error:', err);
    res.redirect('/');
  }
});

// GET /auth/me - Get current user info
router.get('/me', isAuthenticated, (req, res) => {
  res.json({ success: true, data: req.session.user });
});

// GET /auth/employee-login - Render employee login page
router.get('/employee-login', (req, res) => {
  res.render('auth/employee-login', {
    title: 'Employee Login',
    error: req.query.error,
    values: {},
    csrfToken: req.csrfToken(),
    user: req.session.user || null,
    employee: req.session.employee || null
  });
});

// POST /auth/employee/request-passcode - Request passcode for employee login
router.post('/employee/request-passcode', authLimiter, async (req, res) => {
  const { email } = req.body;
  console.log('[EMPLOYEE PASSCODE REQUEST] Received email:', email);
  if (!email) {
    console.log('[EMPLOYEE PASSCODE REQUEST] No email provided');
    return res.render('auth/employee-login', {
      title: 'Employee Login',
      error: 'Please enter your email',
      values: { email },
      csrfToken: req.csrfToken(),
      user: req.session.user || null,
      employee: req.session.employee || null
    });
  }
  // Find employee by email
  const employee = db.get('SELECT * FROM employee WHERE email = ? AND deleted_at IS NULL', [email]);
  if (!employee) {
    console.log('[EMPLOYEE PASSCODE REQUEST] No employee found for email:', email);
    return res.render('auth/employee-login', {
      title: 'Employee Login',
      error: 'No employee found with that email',
      values: { email },
      csrfToken: req.csrfToken(),
      user: req.session.user || null,
      employee: req.session.employee || null
    });
  }
  // Generate passcode and store
  const passcode = employeeModel.createEmployeePasscode(employee.tenant_uid, employee.employee_uid, email);
  console.log('[EMPLOYEE PASSCODE REQUEST] Passcode generated for', email, ':', passcode);
  // Send passcode via email (MVP: log to console, but use nodemailer if configured)
  if (process.env.SMTP_HOST) {
    console.log('[EMPLOYEE PASSCODE REQUEST] SMTP_HOST detected, sending email');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'no-reply@rsu-platform.com',
      to: email,
      subject: 'Your Employee Login Passcode',
      text: `Your login passcode is: ${passcode}`
    });
  } else {
    console.log(`[EMPLOYEE PASSCODE REQUEST] Passcode for ${email}: ${passcode}`);
  }
  // Show passcode entry form
  res.render('auth/employee-passcode', {
    title: 'Enter Passcode',
    email,
    error: null,
    csrfToken: req.csrfToken(),
    user: req.session.user || null,
    employee: req.session.employee || null
  });
});

// GET /auth/employee-passcode - Render passcode entry form (if user refreshes)
router.get('/employee-passcode', (req, res) => {
  const { email } = req.query;
  res.render('auth/employee-passcode', {
    title: 'Enter Passcode',
    email,
    error: null,
    csrfToken: req.csrfToken(),
    user: req.session.user || null,
    employee: req.session.employee || null
  });
});

// POST /auth/employee/verify-passcode - Verify passcode and log in employee
router.post('/employee/verify-passcode', authLimiter, (req, res) => {
  const { email, passcode } = req.body;
  if (!email || !passcode) {
    return res.render('auth/employee-passcode', {
      title: 'Enter Passcode',
      email,
      error: 'Please enter your email and passcode',
      user: req.session.user || null,
      employee: req.session.employee || null
    });
  }
  // Find employee
  const employee = db.get('SELECT * FROM employee WHERE email = ? AND deleted_at IS NULL', [email]);
  if (!employee) {
    return res.render('auth/employee-passcode', {
      title: 'Enter Passcode',
      email,
      error: 'No employee found with that email',
      user: req.session.user || null,
      employee: req.session.employee || null
    });
  }
  // Verify passcode
  const valid = employeeModel.verifyEmployeePasscode(employee.tenant_uid, email, passcode);
  if (!valid) {
    return res.render('auth/employee-passcode', {
      title: 'Enter Passcode',
      email,
      error: 'Invalid or expired passcode',
      user: req.session.user || null,
      employee: req.session.employee || null
    });
  }
  // Store employee in session
  req.session.employee = {
    employee_uid: employee.employee_uid,
    tenant_uid: employee.tenant_uid,
    email: employee.email,
    first_name: employee.first_name,
    last_name: employee.last_name,
    status: employee.status
  };
  // Enforce session separation: clear admin session if set
  if (req.session.user) {
    delete req.session.user;
  }
  // Redirect to employee dashboard
  res.redirect('/employee/dashboard');
});

// Helper function to get list of timezones
function getTimezones() {
  // Get IANA timezone list
  return [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Singapore',
    'Australia/Sydney'
  ];
}

// Helper function to get list of currencies
function getCurrencies() {
  return [
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'GBP', name: 'British Pound', symbol: '£' },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
    { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
    { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
    { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
    { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' }
  ];
}

module.exports = router; 