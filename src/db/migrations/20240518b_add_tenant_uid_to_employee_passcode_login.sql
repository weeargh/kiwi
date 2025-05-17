-- Migration: Add tenant_uid to employee_passcode_login
ALTER TABLE employee_passcode_login ADD COLUMN tenant_uid TEXT NOT NULL DEFAULT ''; 