const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { nanoid } = require('nanoid');

// Define database path from environment or use default
const dbPath = process.env.DB_PATH || './data/rsu_platform.db';
const dbDir = path.dirname(dbPath);

// Create data directory if it doesn't exist
if (!fs.existsSync(dbDir)) {
  console.log(`Creating directory: ${dbDir}`);
  fs.mkdirSync(dbDir, { recursive: true });
}

// Create sessions directory if it doesn't exist
if (!fs.existsSync('./data')) {
  fs.mkdirSync('./data');
}

// Connect to database
let db;
try {
  db = new Database(dbPath);
  console.log(`Connected to SQLite database at ${dbPath}`);
} catch (err) {
  console.error('Error connecting to database:', err.message);
  process.exit(1);
}

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Function to apply migrations
const applyMigrations = () => {
  return new Promise((resolve, reject) => {
    try {
      // 1. Create schema_migrations table if it doesn't exist
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          filename TEXT PRIMARY KEY
        )
      `);
      console.log('Checked/created schema_migrations table.');

      // Check for pre-existing display_decimal_places column in tenant table
      // and mark the relevant migration as applied if necessary.
      try {
        const tableInfoStmt = db.prepare("PRAGMA table_info(tenant)");
        const columns = tableInfoStmt.all();
        const hasDecimalPlacesColumn = columns.some(col => col.name === 'display_decimal_places');

        if (hasDecimalPlacesColumn) {
          const checkAppliedStmt = db.prepare("SELECT 1 FROM schema_migrations WHERE filename = ?");
          const isApplied = checkAppliedStmt.get('2024-tenant-display-decimal-places.sql');
          if (!isApplied) {
            db.prepare("INSERT OR IGNORE INTO schema_migrations (filename) VALUES (?)")
              .run('2024-tenant-display-decimal-places.sql');
            console.log('Pre-existing display_decimal_places column found. Marked 2024-tenant-display-decimal-places.sql as applied.');
          }
        }
      } catch (pragmaErr) {
        // This might happen if tenant table doesn't exist yet during a very first run, which is fine.
        console.warn('Could not check tenant table info for display_decimal_places, possibly table does not exist yet.', pragmaErr.message);
      }

      // 2. Get list of applied migrations
      const getAppliedMigrationsStmt = db.prepare('SELECT filename FROM schema_migrations');
      const appliedMigrations = new Set(getAppliedMigrationsStmt.all().map(row => row.filename));
      console.log('Applied migrations:', Array.from(appliedMigrations));

      // 3. Get list of migration files from the directory
      const migrationsDir = path.join(__dirname, 'migrations');
      let migrationFiles = [];
      if (fs.existsSync(migrationsDir)) {
        migrationFiles = fs.readdirSync(migrationsDir)
          .filter(file => file.endsWith('.sql'))
          .sort(); // Sort alphabetically/chronologically
      }
      console.log('Found migration files:', migrationFiles);

      // 4. Apply pending migrations
      migrationFiles.forEach(file => {
        if (!appliedMigrations.has(file)) {
          console.log(`Applying migration: ${file}...`);
          const filePath = path.join(migrationsDir, file);
          const sql = fs.readFileSync(filePath, 'utf8');
          
          // Wrap each migration in a transaction
          const migrationTransaction = db.transaction(() => {
            db.exec(sql); // better-sqlite3 can execute multiple statements in one string
            const insertMigrationStmt = db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)');
            insertMigrationStmt.run(file);
          });

          try {
            migrationTransaction();
            console.log(`Successfully applied migration: ${file}`);
          } catch (err) {
            console.error(`Error applying migration ${file}:`, err.message);
            // If a migration fails, we should stop and not mark it as applied.
            // The transaction will automatically roll back.
            throw new Error(`Migration ${file} failed: ${err.message}`); 
          }
        }
      });
      console.log('All pending migrations applied successfully.');
      resolve();
    } catch (err) {
      console.error('Error during migration process:', err);
      reject(err);
    }
  });
};

// Execute a statement
const run = (sql) => {
  try {
    db.prepare(sql).run();
  } catch (err) {
    console.error(`Error executing SQL: ${sql.substring(0, 100)}...`);
    console.error(err);
    throw err;
  }
};

// Create tables in the correct order
const createTables = () => {
  return new Promise((resolve, reject) => {
    try {
      // Use transaction for creating tables
      const createTablesTransaction = db.transaction(() => {
        // Tenant table
        run(`
          CREATE TABLE IF NOT EXISTS tenant (
            tenant_uid TEXT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            currency CHAR(3) NOT NULL,
            timezone VARCHAR(50) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TIMESTAMP
          )
        `);

        // UserAccount table
        run(`
          CREATE TABLE IF NOT EXISTS user_account (
            user_uid TEXT PRIMARY KEY,
            tenant_uid TEXT NOT NULL,
            email VARCHAR(255) NOT NULL,
            name VARCHAR(100) NOT NULL,
            password_hash VARCHAR(100) NOT NULL,
            role VARCHAR(10) NOT NULL CHECK (role IN ('admin', 'employee')),
            status VARCHAR(10) NOT NULL CHECK (status IN ('active', 'inactive')),
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TIMESTAMP,
            FOREIGN KEY (tenant_uid) REFERENCES tenant(tenant_uid)
          )
        `);

        // Create a unique index on email per tenant (for active records only)
        run(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email_tenant_active 
          ON user_account(tenant_uid, email) 
          WHERE deleted_at IS NULL
        `);

        // Employee table
        run(`
          CREATE TABLE IF NOT EXISTS employee (
            employee_uid TEXT PRIMARY KEY,
            tenant_uid TEXT NOT NULL,
            email VARCHAR(255) NOT NULL,
            first_name VARCHAR(50) NOT NULL,
            last_name VARCHAR(50) NOT NULL,
            status VARCHAR(10) NOT NULL CHECK (status IN ('active', 'inactive', 'terminated')),
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TIMESTAMP,
            FOREIGN KEY (tenant_uid) REFERENCES tenant(tenant_uid)
          )
        `);

        // Create a unique index on email per tenant (for active records only)
        run(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_email_tenant_active 
          ON employee(tenant_uid, email) 
          WHERE deleted_at IS NULL
        `);

        // EquityPool table
        run(`
          CREATE TABLE IF NOT EXISTS equity_pool (
            pool_uid TEXT PRIMARY KEY,
            tenant_uid TEXT NOT NULL,
            initial_amount REAL NOT NULL CHECK (initial_amount >= 0),
            total_pool REAL NOT NULL CHECK (total_pool >= 0),
            created_by TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TIMESTAMP,
            FOREIGN KEY (tenant_uid) REFERENCES tenant(tenant_uid),
            FOREIGN KEY (created_by) REFERENCES user_account(user_uid)
          )
        `);

        // PoolEvent table
        run(`
          CREATE TABLE IF NOT EXISTS pool_event (
            event_uid TEXT PRIMARY KEY,
            pool_uid TEXT NOT NULL,
            tenant_uid TEXT NOT NULL,
            amount REAL NOT NULL,
            event_type VARCHAR(10) NOT NULL CHECK (event_type IN ('initial', 'top_up', 'reduction')),
            effective_date DATE NOT NULL,
            notes TEXT,
            created_by TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (pool_uid) REFERENCES equity_pool(pool_uid),
            FOREIGN KEY (tenant_uid) REFERENCES tenant(tenant_uid),
            FOREIGN KEY (created_by) REFERENCES user_account(user_uid)
          )
        `);

        // PPSHistory table
        run(`
          CREATE TABLE IF NOT EXISTS pps_history (
            pps_uid TEXT PRIMARY KEY,
            tenant_uid TEXT NOT NULL,
            effective_date DATE NOT NULL,
            price_per_share REAL NOT NULL CHECK (price_per_share >= 0),
            created_by TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TIMESTAMP,
            FOREIGN KEY (tenant_uid) REFERENCES tenant(tenant_uid),
            FOREIGN KEY (created_by) REFERENCES user_account(user_uid)
          )
        `);

        // Create an index for efficient PPS lookup
        run(`
          CREATE INDEX IF NOT EXISTS idx_pps_lookup 
          ON pps_history(tenant_uid, effective_date, created_at DESC)
        `);

        // Grant table
        run(`
          CREATE TABLE IF NOT EXISTS grant_record (
            grant_uid TEXT PRIMARY KEY,
            tenant_uid TEXT NOT NULL,
            employee_uid TEXT NOT NULL,
            grant_date DATE NOT NULL,
            share_amount REAL NOT NULL CHECK (share_amount > 0),
            vested_amount REAL NOT NULL DEFAULT 0 CHECK (vested_amount >= 0),
            status VARCHAR(10) NOT NULL CHECK (status IN ('active', 'inactive')),
            termination_date DATE,
            unvested_shares_returned REAL DEFAULT 0 CHECK (unvested_shares_returned >= 0),
            termination_reason TEXT,
            terminated_by TEXT,
            version INTEGER NOT NULL DEFAULT 0,
            created_by TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            deleted_at TIMESTAMP,
            FOREIGN KEY (tenant_uid) REFERENCES tenant(tenant_uid),
            FOREIGN KEY (employee_uid) REFERENCES employee(employee_uid),
            FOREIGN KEY (terminated_by) REFERENCES user_account(user_uid),
            FOREIGN KEY (created_by) REFERENCES user_account(user_uid)
          )
        `);

        // Create indexes for grant table
        run(`CREATE INDEX IF NOT EXISTS idx_grant_employee ON grant_record(employee_uid, tenant_uid)`);
        run(`CREATE INDEX IF NOT EXISTS idx_grant_status ON grant_record(status)`);
        run(`CREATE INDEX IF NOT EXISTS idx_grant_date ON grant_record(grant_date)`);

        // Vesting processing status table
        run(`
          CREATE TABLE IF NOT EXISTS vesting_processing_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            grant_uid TEXT NOT NULL,
            tenant_uid TEXT NOT NULL,
            last_processed_date TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            message TEXT,
            created_by TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (grant_uid) REFERENCES grant_record(grant_uid),
            FOREIGN KEY (tenant_uid) REFERENCES tenant(tenant_uid),
            FOREIGN KEY (created_by) REFERENCES user_account(user_uid)
          )
        `);

        // Create indexes for vesting_processing_status table
        run(`CREATE INDEX IF NOT EXISTS idx_vps_grant_tenant ON vesting_processing_status(grant_uid, tenant_uid)`);
        run(`CREATE INDEX IF NOT EXISTS idx_vps_status ON vesting_processing_status(status)`);
        // Create unique constraint on vesting_event to prevent duplicates
        // run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_vesting_event_unique ON vesting_event(grant_uid, vest_date)`);
        // console.log('Created unique constraint on vesting_event(grant_uid, vest_date) to prevent duplicates');
        run(`CREATE INDEX IF NOT EXISTS idx_vps_date ON vesting_processing_status(last_processed_date)`);

        // VestingEvent table
        run(`
          CREATE TABLE IF NOT EXISTS vesting_event (
            vesting_uid TEXT PRIMARY KEY,
            grant_uid TEXT NOT NULL,
            tenant_uid TEXT NOT NULL,
            vest_date DATE NOT NULL,
            shares_vested REAL NOT NULL CHECK (shares_vested > 0),
            pps_snapshot REAL,
            created_by TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (grant_uid) REFERENCES grant_record(grant_uid),
            FOREIGN KEY (tenant_uid) REFERENCES tenant(tenant_uid),
            FOREIGN KEY (created_by) REFERENCES user_account(user_uid)
          )
        `);
        // Add back the unique index creation for vesting_event
        run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_vesting_event_unique ON vesting_event(grant_uid, vest_date)`);
        console.log('Created unique constraint on vesting_event(grant_uid, vest_date) to prevent duplicates');
        // Create index for vesting events
        run(`
          CREATE INDEX IF NOT EXISTS idx_vesting_events_date 
          ON vesting_event(tenant_uid, vest_date)
        `);

        // AuditLog table
        run(`
          CREATE TABLE IF NOT EXISTS audit_log (
            log_id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_uid TEXT NOT NULL,
            user_uid TEXT,
            action_type VARCHAR(40) NOT NULL,
            entity_type VARCHAR(40),
            entity_uid TEXT,
            details TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tenant_uid) REFERENCES tenant(tenant_uid),
            FOREIGN KEY (user_uid) REFERENCES user_account(user_uid)
          )
        `);

        // Create indexes for audit logs
        run(`
          CREATE INDEX IF NOT EXISTS idx_audit_logs_entity 
          ON audit_log(tenant_uid, entity_type, entity_uid)
        `);
        run(`
          CREATE INDEX IF NOT EXISTS idx_audit_logs_action 
          ON audit_log(tenant_uid, action_type)
        `);
      });

      // Execute the transaction
      createTablesTransaction();
      console.log('All tables created successfully');
      resolve();
    } catch (err) {
      console.error('Error creating tables:', err);
      reject(err);
    }
  });
};

// Create the initial admin and tenant if they don't exist
const createInitialData = async () => {
  try {
    const bcrypt = require('bcrypt');
    const saltRounds = 12;
    // Check if there's at least one tenant
    const countResult = await new Promise((resolve, reject) => {
      const stmt = db.prepare('SELECT COUNT(*) as count FROM tenant');
      const row = stmt.get();
      resolve(row);
    });
    if (countResult.count === 0) {
      // Begin transaction
      await new Promise((resolve, reject) => {
        db.transaction(() => {
          // Create a default tenant
          const defaultTenant = {
            name: 'Demo Company',
            currency: process.env.DEFAULT_CURRENCY || 'USD',
            timezone: process.env.DEFAULT_TIMEZONE || 'America/New_York'
          };
          const tenantUid = nanoid(10);
          db.prepare('INSERT INTO tenant (tenant_uid, name, currency, timezone) VALUES (?, ?, ?, ?)').run(tenantUid, defaultTenant.name, defaultTenant.currency, defaultTenant.timezone);
          console.log(`Created default tenant with UID: ${tenantUid}`);
          // Create a default admin user
          const defaultAdmin = {
            email: 'admin@example.com',
            name: 'Admin User',
            password: 'admin123', // This would be a secure password in production
            role: 'admin',
            status: 'active'
          };
          // Hash the password
          const hash = bcrypt.hashSync(defaultAdmin.password, saltRounds);
          const userUid = nanoid(12);
          db.prepare('INSERT INTO user_account (user_uid, tenant_uid, email, name, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userUid, tenantUid, defaultAdmin.email, defaultAdmin.name, hash, defaultAdmin.role, defaultAdmin.status);
          console.log(`Created default admin user with UID: ${userUid}`);
          // Create initial equity pool
          const initialAmount = 1000000; // 1 million shares
          const poolUid = nanoid(12);
          db.prepare('INSERT INTO equity_pool (pool_uid, tenant_uid, initial_amount, total_pool, created_by) VALUES (?, ?, ?, ?, ?)').run(poolUid, tenantUid, initialAmount, initialAmount, userUid);
          console.log(`Created initial equity pool with UID: ${poolUid}`);
          // Record initial pool event
          const eventUid = nanoid(14);
          db.prepare('INSERT INTO pool_event (event_uid, pool_uid, tenant_uid, amount, event_type, effective_date, created_by) VALUES (?, ?, ?, ?, ?, date(\'now\'), ?)').run(eventUid, poolUid, tenantUid, initialAmount, 'initial', userUid);
          console.log('Initial pool event recorded');
          // Set initial PPS ($1 per share)
          const ppsUid = nanoid(14);
          db.prepare('INSERT INTO pps_history (pps_uid, tenant_uid, effective_date, price_per_share, created_by) VALUES (?, ?, date(\'now\'), ?, ?)').run(ppsUid, tenantUid, 1.000, userUid);
          console.log('Initial PPS set');
        });
      });
      console.log('Initial data setup complete!');
      console.log(`\n        Demo credentials:\n        - URL: http://localhost:${process.env.PORT || 3000}\n        - Email: admin@example.com\n        - Password: admin123\n        \n        IMPORTANT: Change these credentials in production!\n      `);
    } else {
      console.log('Database already has tenants. Skipping initial data setup.');
    }
  } catch (err) {
    console.error('Error checking tenant count:', err.message);
    throw err;
  }
};

// Run setup
(async () => {
  try {
    await createTables();
    await applyMigrations(); // Apply migrations after tables are created/ensured
    await createInitialData();
    console.log('Database setup completed successfully');
  } catch (err) {
    console.error('Database setup failed:', err);
  } finally {
    // Close the database connection
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err.message);
      } else {
        console.log('Database connection closed');
      }
    });
  }
})(); 