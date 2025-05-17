-- Migration: Add employee_passcode_login table
CREATE TABLE IF NOT EXISTS employee_passcode_login (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_uid TEXT NOT NULL,
    email TEXT NOT NULL,
    passcode TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- Index for quick lookup by email and passcode
CREATE INDEX IF NOT EXISTS idx_employee_passcode_email ON employee_passcode_login(email);
CREATE INDEX IF NOT EXISTS idx_employee_passcode_code ON employee_passcode_login(passcode); 