-- Migration: Add missing columns to audit_log for robust audit logging
ALTER TABLE audit_log ADD COLUMN before_data TEXT; -- JSON: state before action
ALTER TABLE audit_log ADD COLUMN after_data TEXT;  -- JSON: state after action
ALTER TABLE audit_log ADD COLUMN status VARCHAR(20); -- e.g. 'success', 'failure'
ALTER TABLE audit_log ADD COLUMN ip_address TEXT; -- IP address of user 