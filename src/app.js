// require('./utils/instrument.js'); // Sentry removed, initial require no longer needed for Sentry
const express = require('express');
const path = require('path');
const morgan = require('morgan');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const Database = require('better-sqlite3');
const SQLiteStore = require('better-sqlite3-session-store')(session);
const csrf = require('csurf');
const flash = require('connect-flash');
const { DateTime } = require('luxon');
const fs = require('fs');
// const Sentry = require('./utils/instrument.js'); // Sentry removed
require('dotenv').config();

// Custom middlewares
const ejsLayouts = require('./middlewares/ejs-layouts');
const { setTenantId } = require('./middlewares/auth');
const { autoProcessVesting } = require('./middlewares/vesting');

// Jobs and schedulers
const { initializeScheduler } = require('./jobs/scheduler');

// Add db import here
const db = require('./db');

// Initialize the app
const app = express();
const port = process.env.PORT || 3000;

// app.use(Sentry.Handlers.requestHandler()); // Sentry removed
// app.use(Sentry.Handlers.tracingHandler()); // Sentry removed

console.log('SERVER STARTED');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
    },
  },
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Session setup
const sessionsPath = path.join(__dirname, '..', 'data', 'sessions.db');

// Initialize sessions database with correct schema
try {
  const sessionsDb = new Database(sessionsPath);
  
  // Create the sessions table with the expected schema
  sessionsDb.prepare(`
    CREATE TABLE IF NOT EXISTS sessions
    (
      sid TEXT PRIMARY KEY,
      sess TEXT,
      expire INTEGER
    )
  `).run();
  
  // Create an index on the expire column
  sessionsDb.prepare(`
    CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire)
  `).run();
  
  // Close the database connection
  sessionsDb.close();
  
  console.log('Sessions database initialized successfully');
} catch (err) {
  console.error('Error initializing sessions database:', err);
}

// Initialize session middleware with improved security
app.use(session({
  store: new SQLiteStore({
    client: new Database(sessionsPath),
    expired: {
      clear: true,
      intervalMs: 900000 // ms = 15min
    },
    // Set the table name to match our schema
    table: 'sessions'
  }),
  // Use environment variable with a more complex fallback (still not for production)
  secret: process.env.SESSION_SECRET || 
    `dev_${Math.random().toString(36).substring(2, 15)}_${Date.now().toString(36)}`,
  resave: false,
  saveUninitialized: false,
  // More secure cookie settings
  cookie: {
    httpOnly: true, // Prevent client-side JS from reading
    secure: process.env.NODE_ENV === 'production', // Require HTTPS in production
    sameSite: 'lax', // Prevent CSRF attacks
    maxAge: 4 * 60 * 60 * 1000, // 4 hours instead of 24
  },
  // Add name to avoid using default (connect.sid)
  name: 'esop_session',
  // Additional security settings
  rolling: true // Reset expiration countdown on activity
}));

// Force HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (!req.secure && req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// Set security headers
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Enable XSS protection in older browsers
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Disable caching for authenticated pages
  if (req.session && req.session.auth) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use(flash());

// Simplified session handling - admin only approach
app.use((req, res, next) => {
  if (req.session) {
    const hasUserConflict = req.session.user && req.session.employee;
    const hasAuthConflict = req.session.auth && (req.session.user || req.session.employee);
    
    // Check for critical conflict and destroy the session if needed
    if (hasUserConflict || hasAuthConflict) {
      console.error('[SESSION CRITICAL] Conflict detected, will destroy session');
      // Add this flag to be able to redirect on next middleware
      req.sessionForceReset = true;
      // Remove session data immediately for current request
      delete req.session.user;
      delete req.session.employee;
      
      // Conditionally save the auth data if it exists
      if (req.session.auth) {
        // Keep only the auth object with admin role
        const savedAuth = { ...req.session.auth, role: 'admin', type: 'user' };
        req.session.regenerate((err) => {
          if (err) {
            console.error('Error regenerating session:', err);
          }
          req.session.auth = savedAuth;
          // Save the session
          req.session.save();
        });
      } else {
        return req.session.destroy((err) => {
          if (err) {
            console.error('[SESSION CRITICAL] Error destroying session:', err);
          }
          return res.redirect('/auth/login?error=Session+conflict+detected.+Please+login+again.');
        });
      }
    } else {
      // Normal session cleanup - if no conflict exists
      
      // If we have the old user object but no auth object, migrate it
      if (req.session.user && !req.session.auth) {
        console.log('[SESSION CLEANUP] Found old user key, migrating to auth');
        req.session.auth = {
          ...req.session.user,
          role: 'admin',
          type: 'user'
        };
        delete req.session.user;
      }
      
      // Clean up any employee session data
      if (req.session.employee) {
        console.log('[SESSION CLEANUP] Found employee key, removing it');
        delete req.session.employee;
      }
      
      // Make sure any existing auth has admin role
      if (req.session.auth) {
        req.session.auth.role = 'admin';
        req.session.auth.type = 'user';
      }
      
      // Save session changes immediately to ensure they're applied
      if (req.session.save) {
        req.session.save();
      }
    }
  }
  next();
});

// Middleware to handle session conflict redirects
app.use((req, res, next) => {
  if (req.sessionForceReset && !req.path.includes('/auth/login')) {
    console.log('[SESSION REDIRECT] Redirecting due to session conflict');
    return res.redirect('/auth/login?error=Session+conflict+detected.+Please+login+again.');
  }
  next();
});

// CSRF protection
const csrfProtection = csrf({ cookie: true });

// Apply CSRF protection to all routes
app.use(csrfProtection);

// Debug middleware to track CSRF token availability
app.use((req, res, next) => {
  try {
    // Generate a token but don't expose it yet - just verify it works
    const token = req.csrfToken();
    console.log("CSRF token successfully generated");
  } catch (e) {
    console.error("Failed to generate CSRF token:", e.message);
  }
  next();
});

// Debug: Log session on every request (development only)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log('SESSION DEBUG:', req.session);
    next();
  });
}

// Set locals for EJS templates - ADMIN ONLY approach
app.use((req, res, next) => {
  // ALWAYS set employee to null for admin-only mode
  res.locals.employee = null;
  res.locals.user = null;
  res.locals.auth = null;
  
  // Use auth object exclusively for authentication state
  if (req.session && req.session.auth) {
    // Force the role to be admin for safety
    req.session.auth.role = 'admin';
    req.session.auth.type = 'user';
    
    // Set auth in locals
    res.locals.auth = req.session.auth;
    
    // Admin only: set user from auth
    res.locals.user = req.session.auth;
  }

  // Make sure we set currentYear for templates
  res.locals.currentYear = DateTime.now().year;
  next();
});

// Make request user and csrfToken available to all templates
app.use((req, res, next) => {
  try {
    // Make the csrf token available to all views
    res.locals.csrfToken = req.csrfToken();
    console.log("Set csrfToken in res.locals:", !!res.locals.csrfToken);
  } catch (e) {
    console.error("Error setting csrfToken in res.locals:", e.message);
    if (process.env.NODE_ENV !== 'production') {
      res.locals.csrfToken = 'csrf-token-error';
      console.log("Using fallback CSRF token for development");
    }
  }

  // Ensure we have the latest tenant information for the currently logged in user
  if (req.session && req.session.auth) {
    const tenantUid = req.session.auth.tenant_uid;
    if (tenantUid) {
      const tenant = db.get('SELECT tenant_uid, name, currency, timezone FROM tenant WHERE tenant_uid = ?', [tenantUid]);
      if (tenant) {
        // Update the auth object with fresh tenant info
        res.locals.auth = {
          ...res.locals.auth,
          tenant_uid: tenant.tenant_uid,
          tenant_name: tenant.name,
          currency: tenant.currency,
          timezone: tenant.timezone
        };
      }
    }
  }

  // Middleware to transfer flash messages to res.locals for the views
  const successMessages = req.flash('success');
  const errorMessages = req.flash('error');

  res.locals.success = successMessages.length > 0 ? successMessages[0] : null;
  res.locals.error = errorMessages.length > 0 ? errorMessages[0] : null;

  next();
});

// Apply EJS layouts after setting up common locals
app.use(ejsLayouts({
  layoutsDir: path.join(__dirname, 'views')
}));

// Set tenant ID for all authenticated requests
app.use(setTenantId);

// Automatic vesting middleware - process vesting for all relevant routes
app.use(autoProcessVesting);

// Define routes
const routes = {
  index: require('./routes/index'),
  auth: require('./routes/auth'),
  authReset: require('./routes/auth-reset'),
  authDebug: require('./routes/auth-debug'),
  pools: require('./routes/pools'),
  pps: require('./routes/pps'),
  employees: require('./routes/employees'),
  grants: require('./routes/grants'),
  vesting: require('./routes/vesting'),
  import: require('./routes/import'),
  reports: require('./routes/reports')
};

// Use routes
app.use('/', routes.index);
app.use('/auth', routes.auth);
app.use('/reset-session', routes.authReset); // Add easy-to-access session reset route
app.use('/debug-session', routes.authDebug); // Add debug tools
console.log('Auth reset route registered');
app.use('/pools', routes.pools);
console.log('Pools route registered');
app.use('/pps', routes.pps);
app.use('/employees', routes.employees);
app.use('/grants', routes.grants);
app.use('/vesting', routes.vesting);
app.use('/import', routes.import);
app.use('/reports', routes.reports);
console.log('Reports route registered');

// Create stub routes for routes that haven't been implemented yet
const createStubRoute = (routeName) => {
  const router = express.Router();
  router.get('/', (req, res) => {
    res.render('stub', { 
      title: routeName.charAt(0).toUpperCase() + routeName.slice(1),
      routeName,
      message: `The ${routeName} module is not implemented yet.`
    });
  });
  return router;
};

// Apply stub routes
app.use('/tenant', (req, res) => {
  res.redirect('/settings');
});
app.use('/users', createStubRoute('users'));
// app.use('/audit-logs', createStubRoute('audit logs'));
app.use('/audit-logs', require('./routes/audit-logs'));
app.use('/constants', createStubRoute('constants'));

// Mount the settings router
app.use('/settings', require('./routes/settings'));

// Grantee routes
app.use('/grantee', require('./routes/grantee'));
app.use('/css/kiwi.css', express.static(path.join(__dirname, 'views/grantee/kiwi.css')));

// Error handlers
app.use((req, res, next) => {
  res.status(404).render('error-404');
});

// Specific handler for CSRF errors
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    console.error('CSRF attack detected or token expired');
    
    // Log the error details for debugging
    console.error({
      path: req.path,
      method: req.method,
      headers: req.headers,
      cookies: req.cookies
    });
    
    // For API requests, return JSON error
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(403).json({ 
        error: 'CSRF token validation failed',
        message: 'Security validation failed. Please refresh the page and try again.'
      });
    }
    
    // For regular requests, redirect to login page or show error page
    if (req.session) {
      // Clear the session to force re-login
      req.session.destroy(() => {
        res.redirect('/auth/login?error=security');
      });
    } else {
      res.status(403).render('error', { 
        message: 'Security Validation Failed',
        error: {
          status: 403,
          stack: process.env.NODE_ENV === 'development' 
            ? 'CSRF token validation failed. Try refreshing the page.'
            : ''
        }
      });
    }
    return;
  }
  
  // Pass to next error handler if not a CSRF error
  next(err);
});

// General error handler
app.use((err, req, res, next) => {
  console.error('GLOBAL ERROR HANDLER:', err);
  res.status(500).render('error', {
    message: 'Internal Server Error',
    error: err
  });
});

// Add this at the end of all routes and middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  // Option 1: Show a friendly error page
  res.status(500).render('error', { message: 'Something went wrong. Please try again later.' });
  // Option 2: Redirect to external site
  // res.redirect('https://kiwi-equity.com');
});

// Start server with proper error handling
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`RSU Platform server running on port ${port}`);
  
  // Initialize scheduled jobs after server has started
  initializeScheduler();
});

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Shutting down.`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
  }
});

// Handle graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Graceful shutdown function
function gracefulShutdown() {
  console.log('Received shutdown signal, closing server and database connections');
  
  server.close(() => {
    console.log('Server closed');
    
    // Close database connections
    try {
      const db = require('./db');
      db.close();
      console.log('Database connections closed');
    } catch (err) {
      console.error('Error closing database connections:', err.message);
    }
    
    process.exit(0);
  });
  
  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    console.error('Forcing shutdown after timeout');
    process.exit(1);
  }, 10000); // 10 seconds
}

module.exports = app;
