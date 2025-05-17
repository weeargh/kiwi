# Vesting System Documentation

## Overview

The vesting system is a core component of the RSU Platform that automatically calculates and tracks the vesting of shares for employee grants. This document consolidates all information about the vesting system, including its architecture, implementation details, automation features, and troubleshooting guidelines.

## Table of Contents

1. [Core Components](#core-components)
2. [Vesting Algorithm](#vesting-algorithm)
3. [Automatic Vesting System](#automatic-vesting-system)
4. [Implementation Details](#implementation-details)
5. [Recent Improvements](#recent-improvements)
6. [Troubleshooting](#troubleshooting)
7. [File Organization](#file-organization)
8. [Usage Guide](#usage-guide)

## Core Components

The vesting system consists of these key components:

1. **Vesting Service**: Core service that implements the vesting algorithm
   - Located at `/src/services/vesting.js`
   - Handles all vesting calculations and database operations

2. **Auto-Vesting Service**: Handles automatic vesting for new grants
   - Located at `/src/services/autoVesting.js`
   - Ensures new grants have vesting events created immediately

3. **Vesting Batch Service**: Manages batch processing across tenants
   - Located at `/src/services/vestingBatch.js`
   - Processes multiple grants efficiently

4. **Vesting Middleware**: Triggers vesting calculations during page views
   - Located at `/src/middlewares/vesting.js`
   - Ensures vesting is up-to-date when viewing relevant pages

5. **Scheduled Jobs**: Ensures vesting is processed daily
   - Located at `/src/jobs/scheduled-vesting.js`
   - Runs at configurable times for each tenant

## Vesting Algorithm

The vesting calculation follows these rules (per SPECIFICATION.md):

1. **Cliff Period**: Grants have a 12-month cliff period where no shares vest
2. **Total Duration**: After the cliff, shares vest monthly over 48 months total (including the cliff period)
3. **Cliff Vesting**: At month 13, the first 12 months of shares vest at once (25% of the total)
4. **Monthly Vesting**: From months 14-48, shares vest monthly (1/48 of the total each month)
5. **Final Adjustment**: The final tranche is adjusted to account for rounding errors

### Special Cases

- **Month-End Rules**: If a grant is made on the 29th, 30th, or 31st of a month, vesting occurs on the last day of months with fewer days
- **Leap Years**: February 29th grants will vest on February 28th in non-leap years
- **Backdated Grants**: Grants with dates in the past will have vesting events created for all eligible periods immediately

## Automatic Vesting System

The system uses a three-layered approach to ensure vesting is always calculated on time:

### 1. Real-time Calculation

When viewing grant details or grant lists, the system automatically:

- Calculates current vesting status based on the grant date and current date
- Processes any pending vesting events that haven't been created yet
- Updates the displayed vesting percentages and amounts in real-time

**Implementation**: Added to `GET /grants/:id` and `GET /grants` routes

### 2. Request-based Processing

The system includes a middleware that triggers vesting calculations whenever relevant pages are accessed:

- Runs in the background using `setTimeout` to avoid blocking page loads
- Processes vesting for all grants when viewing pages that display grant or vesting information
- Updates the database with new vesting events as needed

**Implementation**: `src/middlewares/vesting.js` middleware applied to all routes in `app.js`

### 3. Scheduled Background Jobs

A daily scheduled job ensures vesting is processed even if no users are accessing the system:

- Runs automatically at 2:00 AM (configurable) in each tenant's timezone
- Processes all active grants across all tenants
- Maintains an audit trail of all automatically created vesting events
- Runs immediately on application startup to ensure everything is up-to-date

**Implementation**: `src/jobs/scheduled-vesting.js` and `src/jobs/scheduler.js` using node-cron

## Implementation Details

### Database Schema

The vesting system uses two main tables:

1. **grant_record**: Stores grant information including total shares and vested amount
2. **vesting_event**: Stores individual vesting events with dates and amounts

Key constraints:
- Unique constraint on `vesting_event(grant_uid, vest_date)` to prevent duplicates
- Foreign key from `vesting_event.grant_uid` to `grant_record.grant_uid`

### Concurrency Control

To prevent duplicate vesting events when multiple processes attempt to calculate vesting simultaneously:

1. **Database Constraints**: Unique constraint on `(grant_uid, vest_date)` prevents duplicates
2. **Transaction Handling**: All vesting events for a grant are created within a single transaction
3. **Locking Mechanism**: The auto-vesting middleware uses a simple locking mechanism to prevent concurrent calculations

### Error Handling

The system includes robust error handling to ensure it continues functioning even when errors occur:

1. **Try-Catch Blocks**: All critical functions include proper error handling
2. **Logging**: Detailed logs are generated for all vesting operations
3. **Graceful Degradation**: If vesting calculation fails, the system continues operating and will retry later

## Recent Improvements

The vesting system has undergone several improvements to enhance reliability and performance:

### 1. Duplicate Prevention

- Added unique constraint on `vesting_event(grant_uid, vest_date)` to prevent duplicate entries
- Enhanced transaction handling to ensure proper concurrency control
- Improved auto-vesting middleware to prevent concurrent calculations

### 2. Cliff Period Handling

- Enhanced logic for handling the 12-month cliff period
- Added special handling for grants that are exactly at the cliff boundary
- Improved date comparison logic to be more robust against timezone issues

### 3. Integrated Vesting Processing

- Made vesting calculation an integral part of the standard grant creation flow
- Every new grant automatically goes through vesting calculation regardless of date
- Added verification steps to ensure proper vesting event creation

### 4. Enhanced Error Handling

- Added comprehensive logging throughout the vesting process
- Improved error recovery to ensure the system continues functioning
- Added detailed diagnostics for troubleshooting

## Troubleshooting

If vesting events are not being created as expected:

1. **Check Grant Status**: Only active grants have vesting events created
2. **Verify Grant Date**: The grant date must be older than the cliff period (12 months)
3. **Check for Duplicates**: Vesting events will not be created if they already exist
4. **Review Logs**: Check the application logs for "Auto-vesting" messages and errors
5. **Manual Verification**: Use `node verify-grant-vesting.js <grant_uid>` to check a specific grant

### Common Issues

1. **No Vesting Events Created**:
   - Verify the grant is active
   - Check if the grant date is recent (less than 12 months old)
   - Ensure the tenant timezone is set correctly

2. **Incorrect Vesting Amounts**:
   - Verify the grant amount is correct
   - Check for any manual vesting events that might affect calculations
   - Ensure the PPS (price per share) is set correctly

3. **Server Crashes During Vesting**:
   - Check for grants with invalid data
   - Verify database integrity
   - Review error logs for specific issues

## File Organization

The vesting system files are organized as follows:

### Core System Files

These files are essential parts of the application:

1. `/src/services/vesting.js` - The main vesting service with core functionality
2. `/src/services/autoVesting.js` - Handles automatic vesting for new grants
3. `/src/services/vestingBatch.js` - Manages batch processing across tenants
4. `/src/middlewares/vesting.js` - Middleware for automatic vesting during page views
5. `/src/routes/vesting.js` - API routes for vesting functionality
6. `/src/jobs/scheduled-vesting.js` - Scheduled job for daily vesting processing
7. `/src/views/grants/add-vesting.ejs` - UI template for adding vesting events

### Utility Scripts

These scripts provide useful functionality:

1. `verify-grant-vesting.js` - Tool for verifying individual grants
2. `process-daily-vesting.js` - Main script for daily vesting processing

### Test Scripts

1. `/tests/vesting-tests.js` - Comprehensive test suite for vesting functionality

### Archived Files

Obsolete scripts have been archived in the `/archive` directory:

1. `process-vesting.js` - Simplified version of process-daily-vesting.js
2. `process-all-vesting.js` - Functionality covered by process-daily-vesting.js
3. `process-backdated-vesting.js` - Now integrated into the main vesting service
4. `fix-vesting.js` - One-time fix script that's no longer needed
5. `fix-duplicate-vesting.js` - One-time fix for duplicate vesting events
6. `verify-vesting-fix.js` - Verification script for the fix
7. `simple-vesting-test.js` - Merged into the consolidated test suite
8. `test-auto-vesting.js` - Merged into the consolidated test suite
9. `test-vesting-duplicates.js` - Merged into the consolidated test suite
10. `fix-problematic-grants.js` - One-time fix for problematic grants

## Usage Guide

### Running Tests

To run the comprehensive test suite:

```bash
NODE_ENV=development node tests/vesting-tests.js
```

### Verifying Individual Grants

To verify vesting for a specific grant:

```bash
node verify-grant-vesting.js <grant_uid>
```

### Processing Daily Vesting

To manually process vesting for all grants:

```bash
node process-daily-vesting.js
```

### Monitoring Vesting

1. **Check the application logs** for "Auto-vesting" messages
2. **View a grant's details page** to see if vesting is calculated in real-time
3. **Monitor the server logs** at 2:00 AM to confirm the scheduled job runs
