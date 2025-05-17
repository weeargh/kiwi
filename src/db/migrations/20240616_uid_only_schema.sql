-- Clean UID-only schema for Kiwi Equity Platform
-- Drop old tables if they exist (for a fresh start)
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS vesting_event;
DROP TABLE IF EXISTS vesting_processing_status;
DROP TABLE IF EXISTS grant_record;
DROP TABLE IF EXISTS pool_event;
DROP TABLE IF EXISTS equity_pool;
DROP TABLE IF EXISTS employee;
DROP TABLE IF EXISTS user_account;
DROP TABLE IF EXISTS tenant;
DROP TABLE IF EXISTS pps_history;

-- Tenant table
CREATE TABLE tenant (
  tenant_uid TEXT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  currency CHAR(3) NOT NULL,
  timezone VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

-- UserAccount table
CREATE TABLE user_account (
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
);
CREATE UNIQUE INDEX idx_user_email_tenant_active ON user_account(tenant_uid, email) WHERE deleted_at IS NULL;

-- Employee table
CREATE TABLE employee (
  employee_uid TEXT PRIMARY KEY,
  tenant_uid TEXT NOT NULL,
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  status VARCHAR(10) NOT NULL CHECK (status IN ('active', 'inactive', 'terminated')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  FOREIGN KEY (tenant_uid) REFERENCES tenant(tenant_uid)
);
CREATE UNIQUE INDEX idx_employee_email_tenant_active ON employee(tenant_uid, email) WHERE deleted_at IS NULL;

-- EquityPool table
CREATE TABLE equity_pool (
  pool_uid TEXT PRIMARY KEY,
  tenant_uid TEXT NOT NULL,
  initial_amount REAL NOT NULL CHECK (initial_amount >= 0),
  total_pool REAL NOT NULL CHECK (total_pool >= 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  FOREIGN KEY (tenant_uid) REFERENCES tenant(tenant_uid),
  FOREIGN KEY (created_by) REFERENCES user_account(user_uid)
);

-- PoolEvent table
CREATE TABLE pool_event (
  event_uid TEXT PRIMARY KEY,
  pool_uid TEXT NOT NULL,
  tenant_uid TEXT NOT NULL,
  amount REAL NOT NULL,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('initial', 'top_up', 'reduction', 'return_vested', 'return_unvested', 'return_boughtback')),
  effective_date DATE NOT NULL,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  employee_uid TEXT,
  grant_uid TEXT,
  FOREIGN KEY (pool_uid) REFERENCES equity_pool(pool_uid),
  FOREIGN KEY (tenant_uid) REFERENCES tenant(tenant_uid),
  FOREIGN KEY (created_by) REFERENCES user_account(user_uid),
  FOREIGN KEY (employee_uid) REFERENCES employee(employee_uid),
  FOREIGN KEY (grant_uid) REFERENCES grant_record(grant_uid)
);

-- PPSHistory table
CREATE TABLE pps_history (
  pps_uid TEXT PRIMARY KEY,
  tenant_uid TEXT NOT NULL,
  effective_date DATE NOT NULL,
  price_per_share REAL NOT NULL CHECK (price_per_share >= 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  FOREIGN KEY (tenant_uid) REFERENCES tenant(tenant_uid),
  FOREIGN KEY (created_by) REFERENCES user_account(user_uid)
);
CREATE INDEX idx_pps_lookup ON pps_history(tenant_uid, effective_date, created_at DESC);

-- Grant table
CREATE TABLE grant_record (
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
);
CREATE INDEX idx_grant_employee ON grant_record(employee_uid, tenant_uid);
CREATE INDEX idx_grant_status ON grant_record(status);
CREATE INDEX idx_grant_date ON grant_record(grant_date);

-- VestingEvent table
CREATE TABLE vesting_event (
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
);
CREATE INDEX idx_vesting_events_date ON vesting_event(tenant_uid, vest_date);

-- AuditLog table
CREATE TABLE audit_log (
  log_uid TEXT PRIMARY KEY,
  tenant_uid TEXT NOT NULL,
  user_uid TEXT,
  action_type VARCHAR(40) NOT NULL,
  entity_type VARCHAR(40),
  entity_uid TEXT,
  details TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_uid) REFERENCES tenant(tenant_uid),
  FOREIGN KEY (user_uid) REFERENCES user_account(user_uid)
);
CREATE INDEX idx_audit_logs_entity ON audit_log(tenant_uid, entity_type, entity_uid);
CREATE INDEX idx_audit_logs_action ON audit_log(tenant_uid, action_type); 