// require('../instrument.js'); // Sentry removed, initial require no longer needed for Sentry
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
// const Sentry = require('../instrument.js'); // Sentry removed
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

// Initialize session middleware
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
  secret: process.env.SESSION_SECRET || 'developmentsecretkey123',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000, // 1 day
  },
}));

app.use(flash());

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

  // Make user available to all templates, always with latest tenant info
  if (req.session.user) {
    const tenantUid = req.session.user.tenant_uid;
    const tenant = db.get('SELECT tenant_uid, name, currency, timezone FROM tenant WHERE tenant_uid = ?', [tenantUid]);
    res.locals.user = {
      ...req.session.user,
      tenant_uid: tenant.tenant_uid,
      tenant_name: tenant.name,
      currency: tenant.currency,
      timezone: tenant.timezone
    };
  } else if (req.session.employee) {
    const tenantUid = req.session.employee.tenant_uid;
    const tenant = db.get('SELECT tenant_uid, name, currency, timezone FROM tenant WHERE tenant_uid = ?', [tenantUid]);
    res.locals.user = {
      tenant_uid: tenant.tenant_uid,
      tenant_name: tenant.name,
      currency: tenant.currency,
      timezone: tenant.timezone
    };
  } else {
    res.locals.user = null;
  }
  res.locals.employee = req.session.employee || null;
  res.locals.currentYear = DateTime.now().year;

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

// Defensive middleware: prevent both admin and employee sessions at once
app.use((req, res, next) => {
  if (req.session && req.session.user && req.session.employee) {
    console.error('Session conflict: both user and employee set. Destroying session.');
    req.session.destroy(() => {
      res.redirect('/auth/login?error=session_conflict');
    });
    return;
  }
  next();
});

// Define routes
const routes = {
  index: require('./routes/index'),
  auth: require('./routes/auth'),
  pools: require('./routes/pools'),
  pps: require('./routes/pps'),
  employees: require('./routes/employees'),
  grants: require('./routes/grants'),
  vesting: require('./routes/vesting'),
  import: require('./routes/import')
};

// Use routes
app.use('/', routes.index);
app.use('/auth', routes.auth);
app.use('/pools', routes.pools);
console.log('Pools route registered');
app.use('/pps', routes.pps);
app.use('/employees', routes.employees);
app.use('/grants', routes.grants);
app.use('/vesting', routes.vesting);
app.use('/import', routes.import);

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