-- Migration: Add employee termination_effective_date and rename grant termination_date to inactive_effective_date

-- 1. Add termination_effective_date to employee table
ALTER TABLE employee ADD COLUMN termination_effective_date DATE;

-- 2. Add inactive_effective_date to grant_record if not exists
ALTER TABLE grant_record ADD COLUMN inactive_effective_date DATE;

-- 3. Backfill inactive_effective_date with existing termination_date values
UPDATE grant_record SET inactive_effective_date = termination_date WHERE termination_date IS NOT NULL;

-- 4. (Optional) Remove termination_date column if not needed (SQLite does not support DROP COLUMN directly)
-- You may need to recreate the table if you want to fully remove the old column.
-- For now, leave it for backward compatibility.

-- 5. Add comments for clarity
-- Employee: status = 'active' or 'terminated', termination_effective_date is the date of termination
-- Grant: status = 'active' or 'inactive', inactive_effective_date is the date grant became inactive 