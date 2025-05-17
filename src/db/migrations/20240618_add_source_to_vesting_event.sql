-- Migration: Add 'source' column to vesting_event table
-- This column will be 'manual' or 'scheduled' for new events
ALTER TABLE vesting_event ADD COLUMN source TEXT DEFAULT NULL; 