const db = require('../db');
const audit = require('../utils/audit');
const poolModel = require('./pool');
const decimal = require('../utils/decimal');
const vestingService = require('../services/vesting');

/**
 * Get a grant by UID
 * @param {string} grantUid - UID of the grant
 * @param {string} tenantUid - UID of the tenant
 * @returns {Object} Grant data or null if not found
 */
function getGrant(grantUid, tenantUid) {
  const grant = db.get(
    `SELECT 
      g.grant_uid, 
      g.tenant_uid, 
      g.employee_uid, 
      g.grant_date, 
      g.share_amount, 
      g.status, 
      g.inactive_effective_date, 
      g.unvested_shares_returned, 
      g.vested_shares_returned, 
      g.version,
      g.created_at,
      e.first_name,
      e.last_name,
      e.email,
      e.termination_effective_date
    FROM grant_record g
    JOIN employee e ON g.employee_uid = e.employee_uid
    WHERE g.grant_uid = ? AND g.tenant_uid = ? AND g.deleted_at IS NULL`,
    [grantUid, tenantUid]
  );
  if (!grant) {
    return null;
  }
  // Get vesting events for this grant
  const vestingEvents = db.query(
    `SELECT 
      vesting_uid, vest_date, shares_vested, pps_snapshot, created_at 
    FROM vesting_event 
    WHERE grant_uid = ? AND tenant_uid = ? 
    ORDER BY vest_date ASC`,
    [grantUid, tenantUid]
  );
  // Calculate vestedAmount as the sum of shares_vested from vesting events
  const vestedAmount = vestingEvents.reduce((sum, event) => sum + parseFloat(event.shares_vested), 0);
  return {
    uid: grant.grant_uid,
    tenantUid: grant.tenant_uid,
    employeeUid: grant.employee_uid,
    grantDate: grant.grant_date,
    shareAmount: grant.share_amount,
    vestedAmount: vestedAmount.toFixed(3),
    status: grant.status,
    inactiveEffectiveDate: grant.inactive_effective_date,
    terminationEffectiveDate: grant.termination_effective_date,
    unvestedSharesReturned: grant.unvested_shares_returned,
    vestedSharesReturned: grant.vested_shares_returned,
    employee: {
      uid: grant.employee_uid,
      firstName: grant.first_name,
      lastName: grant.last_name,
      email: grant.email
    },
    vestingEvents: vestingEvents.map(event => ({
      id: event.vesting_uid,
      vestDate: event.vest_date,
      sharesVested: event.shares_vested,
      ppsSnapshot: event.pps_snapshot,
      createdAt: event.created_at
    })),
    version: grant.version,
    createdAt: grant.created_at
  };
}

/**
 * Get all grants for a tenant
 * @param {string} tenantUid - UID of the tenant
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of records to return
 * @param {number} options.offset - Offset for pagination
 * @param {string} options.status - Filter by status
 * @param {string} options.employeeUid - Filter by employee
 * @param {string} options.search - Filter by employee name or email
 * @returns {Array} List of grant records
 */
function getGrants(tenantUid, options = {}) {
  const { 
    limit = 50, 
    offset = 0, 
    status = null,
    employeeUid = null,
    search = null
  } = options;
  let query = `
    SELECT 
      g.grant_uid, 
      g.employee_uid, 
      g.grant_date, 
      g.share_amount, 
      g.vested_amount, 
      g.status, 
      g.inactive_effective_date,
      g.version,
      g.created_at,
      e.first_name,
      e.last_name,
      e.email,
      e.termination_effective_date
    FROM grant_record g
    JOIN employee e ON g.employee_uid = e.employee_uid
    WHERE g.tenant_uid = ? AND g.deleted_at IS NULL
  `;
  const params = [tenantUid];
  if (status && status !== 'all') {
    query += ' AND g.status = ?';
    params.push(status);
  }
  if (employeeUid) {
    query += ' AND g.employee_uid = ?';
    params.push(employeeUid);
  }
  if (search) {
    query += ` AND (
      g.grant_uid LIKE ? OR
      e.email LIKE ? OR 
      e.first_name LIKE ? OR 
      e.last_name LIKE ?
    )`;
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam, searchParam, searchParam);
  }
  query += ' ORDER BY g.grant_date DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const grants = db.query(query, params);
  if (!Array.isArray(grants)) return grants ? [grants] : [];
  // Add debug logging for grant data
  if (grants.length > 0) {
    console.log(`Grant data from database - First grant: ID=${grants[0].grant_uid}, Share Amount=${grants[0].share_amount}, Vested Amount=${grants[0].vested_amount}`);
  }
  return grants.map(grant => {
    // Ensure proper decimal values
    const shareAmount = parseFloat(grant.share_amount || 0);
    const vestedAmount = parseFloat(grant.vested_amount || 0);
    const unvestedAmount = Math.max(0, shareAmount - vestedAmount); // Ensure non-negative
    return {
      uid: grant.grant_uid,
      employeeUid: grant.employee_uid,
      employee: {
        firstName: grant.first_name,
        lastName: grant.last_name,
        email: grant.email
      },
      grantDate: grant.grant_date,
      shareAmount: shareAmount.toString(),
      vestedAmount: vestedAmount.toString(),
      unvestedAmount: unvestedAmount.toString(),
      status: grant.status,
      inactiveEffectiveDate: grant.inactive_effective_date,
      terminationEffectiveDate: grant.termination_effective_date,
      version: grant.version,
      createdAt: grant.created_at
    };
  });
}

/**
 * Count total grants for pagination
 * @param {string} tenantUid - UID of the tenant
 * @param {Object} options - Query options
 * @param {string} options.status - Filter by status
 * @param {string} options.employeeUid - Filter by employee
 * @param {string} options.search - Filter by employee name or email
 * @returns {number} Total count of grants
 */
function countGrants(tenantUid, options = {}) {
  const { status = null, employeeUid = null, search = null } = options;
  let query = 'SELECT COUNT(*) as count FROM grant_record g JOIN employee e ON g.employee_uid = e.employee_uid WHERE g.tenant_uid = ? AND g.deleted_at IS NULL';
  const params = [tenantUid];
  if (status && status !== 'all') {
    query += ' AND g.status = ?';
    params.push(status);
  }
  if (employeeUid) {
    query += ' AND g.employee_uid = ?';
    params.push(employeeUid);
  }
  if (search) {
    query += ` AND (
      g.grant_uid LIKE ? OR
      e.email LIKE ? OR 
      e.first_name LIKE ? OR 
      e.last_name LIKE ?
    )`;
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam, searchParam, searchParam);
  }
  const result = db.get(query, params);
  return result ? result.count : 0;
}

/**
 * Create grant for a specific employee and automatically process any backdated vesting
 * @param {string} tenantUid - UID of the tenant
 * @param {Object} grantData - Grant data including employee_uid, grant_date, share_amount
 * @param {string} userUid - UID of the user creating the grant
 * @returns {Object} Created grant data
 */
function createGrant(tenantUid, grantData, userUid) {
  const { employeeUid, grantDate, shareAmount } = grantData;
  // Validate share amount decimal precision
  if (!decimal.validateDecimalPrecision(shareAmount)) {
    throw new Error('Share amount must have at most 3 decimal places');
  }
  if (parseFloat(shareAmount) <= 0) {
    throw new Error('Share amount must be greater than zero');
  }
  let auditLog = null;
  let grantObj = null;
  const result = db.transaction((client) => {
    // Check if employee exists and is active
    const employee = client.get(
      'SELECT employee_uid, status FROM employee WHERE employee_uid = ? AND tenant_uid = ? AND deleted_at IS NULL',
      [employeeUid, tenantUid]
    );
    if (!employee) {
      throw new Error('Employee not found');
    }
    if (employee.status !== 'active') {
      throw new Error('Cannot create a grant for an inactive employee');
    }
    // Get pool metrics to check if enough shares are available
    const grantedResult = client.get(
      `SELECT SUM(share_amount) as granted
       FROM grant_record
       WHERE tenant_uid = ? AND status = 'active' AND deleted_at IS NULL`,
      [tenantUid]
    );
    const returnedResult = client.get(
      `SELECT 
         SUM(unvested_shares_returned) as unvested,
         SUM(vested_shares_returned) as vested
       FROM grant_record
       WHERE tenant_uid = ? AND status = 'inactive' AND deleted_at IS NULL`,
      [tenantUid]
    );
    const poolInfo = client.get(
      'SELECT pool_uid, initial_amount, total_pool FROM equity_pool WHERE tenant_uid = ? AND deleted_at IS NULL',
      [tenantUid]
    );
    
    if (!poolInfo) {
      throw new Error('Equity pool not found');
    }
    
    const granted = grantedResult?.granted || 0;
    const returned = (returnedResult?.unvested || 0) + (returnedResult?.vested || 0);
    const available = decimal.subtract(
      decimal.add(poolInfo.total_pool, returned),
      granted
    );
    
    // Check if there are enough available shares
    if (parseFloat(available) < parseFloat(shareAmount)) {
      throw new Error(`Not enough available shares in the pool. Available: ${available}, Requested: ${shareAmount}`);
    }
    // Create the grant
    const insertResult = client.run(
      `INSERT INTO grant_record (
        tenant_uid, employee_uid, grant_date, share_amount, vested_amount, 
        status, version, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantUid, employeeUid, grantDate, shareAmount, 0, 'active', 0, userUid]
    );
    const grantUid = insertResult.lastInsertRowid || insertResult.id;
    auditLog = {
      tenantUid,
      userUid,
      action: 'GRANT_CREATE',
      entityType: 'grant',
      entityUid: grantUid,
      details: {
        after: {
          employee_uid: employeeUid,
          grant_date: grantDate,
          share_amount: shareAmount,
          status: 'active'
        }
      }
    };
    grantObj = {
      uid: grantUid,
      tenantUid,
      employeeUid,
      grantDate,
      shareAmount,
      vestedAmount: 0,
      status: 'active',
      version: 0,
      createdAt: new Date().toISOString()
    };
    return grantObj;
  });
  if (auditLog) audit.logAction(auditLog.tenantUid, auditLog.userUid, auditLog.action, auditLog.entityType, auditLog.entityUid, auditLog.details);
  // Post-transaction: handle auto-vesting if needed
  const currentDate = new Date().toISOString().split('T')[0];
  if (grantDate < currentDate) {
    // Keep a reference to the grant object for the async operation
    const grantRef = { ...grantObj };
    
    // Grant has past date, trigger auto-vesting (async, after commit)
    setTimeout(() => {
      try {
        // Create a new database connection if needed
        let dbClosed = false;
        try {
          // Test if connection is still open by running a simple query
          db.get('SELECT 1');
        } catch (e) {
          // If error, assume connection is closed
          dbClosed = true;
          console.log('[AUTO-VESTING] Database connection was closed, skipping auto-vesting for grant', grantRef.uid);
          return;
        }
        
        if (!dbClosed) {
          const tenant = db.get(
            'SELECT timezone FROM tenant WHERE tenant_uid = ? AND deleted_at IS NULL',
            [tenantUid]
          );
          if (!tenant) {
            console.error(`[AUTO-VESTING] Cannot process vesting: Tenant ${tenantUid} not found`);
            return;
          }
          const autoVestingService = require('../services/autoVesting');
          const events = autoVestingService.processNewGrantVesting(
            grantRef.uid,
            tenantUid,
            grantDate,
            tenant.timezone,
            userUid
          );
          // Optionally log audit for auto-vesting (if needed)
        }
      } catch (error) {
        console.error(`[AUTO-VESTING] Error processing automatic vesting for grant ${grantRef.uid}:`, error);
      }
    }, 0);
  }
  return result;
}

/**
 * Update a grant
 * @param {string} grantUid - UID of the grant to update
 * @param {string} tenantUid - UID of the tenant
 * @param {Object} updates - Fields to update
 * @param {number} updates.version - Current version for optimistic locking
 * @param {string} userUid - UID of the user updating the grant
 * @returns {Object} Updated grant data
 */
function updateGrant(grantUid, tenantUid, updates, userUid) {
  let auditLog = null;
  const result = db.transaction((client) => {
    // Get current grant data for audit and validation
    const currentGrant = client.get(
      'SELECT * FROM grant_record WHERE grant_uid = ? AND tenant_uid = ? AND deleted_at IS NULL',
      [grantUid, tenantUid]
    );
    if (!currentGrant) {
      throw new Error('Grant not found');
    }
    // Optimistic locking check
    if (updates.version !== undefined && updates.version !== currentGrant.version) {
      throw new Error('Grant has been modified by another user. Please refresh and try again.');
    }
    // Prepare update fields
    const updateFields = [];
    const updateParams = [];
    const updateData = {};
    // For now, we only allow updates to notes or metadata fields
    // We don't allow changing the core grant properties once created
    // Increment version
    updateFields.push('version = ?');
    updateParams.push(currentGrant.version + 1);
    updateData.version = currentGrant.version + 1;
    // If there are no other updates, just update the version
    // Add the WHERE clause parameters
    updateParams.push(grantUid, tenantUid, currentGrant.version);
    // Execute the update
    const updateResult = client.run(
      `UPDATE grant_record SET ${updateFields.join(', ')} 
       WHERE grant_uid = ? AND tenant_uid = ? AND version = ?`,
      updateParams
    );
    if (updateResult.changes === 0) {
      throw new Error('Grant has been modified by another user. Please refresh and try again.');
    }
    auditLog = {
      tenantUid,
      userUid,
      action: 'GRANT_UPDATE',
      entityType: 'grant',
      entityUid: grantUid,
      details: {
        before: {
          version: currentGrant.version
        },
        after: updateData
      }
    };
    return getGrant(grantUid, tenantUid);
  });
  if (auditLog) audit.logAction(auditLog.tenantUid, auditLog.userUid, auditLog.action, auditLog.entityType, auditLog.entityUid, auditLog.details);
  return result;
}

/**
 * Terminate a grant
 * @param {string} grantUid - UID of the grant to terminate
 * @param {string} tenantUid - UID of the tenant
 * @param {Object} terminationData - Termination data
 * @param {string} terminationData.terminationDate - Date of termination
 * @param {string} terminationData.reason - Reason for termination
 * @param {string} [terminationData.treatment] - Treatment for vested shares (optional)
 * @param {number} terminationData.version - Current version for optimistic locking
 * @param {string} userUid - UID of the user terminating the grant
 * @param {object} [externalClient] - Optional transaction client
 * @returns {Object} Updated grant data
 */
function terminateGrant(grantUid, tenantUid, terminationData, userUid, externalClient) {
  const { terminationDate, reason, version, treatment } = terminationData;
  let auditLog = null;
  const runInTransaction = (client) => {
    // Get current grant data for audit and validation
    const currentGrant = client.get(
      'SELECT * FROM grant_record WHERE grant_uid = ? AND tenant_uid = ? AND deleted_at IS NULL',
      [grantUid, tenantUid]
    );
    if (!currentGrant) {
      throw new Error('Grant not found');
    }
    // Optimistic locking check
    if (version !== undefined && version !== currentGrant.version) {
      throw new Error('Grant has been modified by another user. Please refresh and try again.');
    }
    // Check if grant is already terminated
    if (currentGrant.status === 'inactive') {
      throw new Error('Grant is already terminated');
    }
    // Calculate unvested and vested shares to be returned
    const unvestedShares = decimal.subtract(
      currentGrant.share_amount,
      currentGrant.vested_amount
    );
    let vestedSharesReturned = 0;
    if (treatment === 'buyback') {
      // Use actual vested shares from vesting_event up to and including the termination date
      const vestedRow = client.get(
        'SELECT SUM(shares_vested) as vested FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ? AND vest_date <= ?',
        [grantUid, tenantUid, terminationDate]
      );
      const vested = parseFloat(vestedRow && vestedRow.vested ? vestedRow.vested : 0);
      // Sum all manual vesting for this grant (regardless of date)
      const manualVestingRow = client.get(
        "SELECT SUM(shares_vested) as manualVested FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ? AND (source LIKE '%manual%' OR source = 'manual')",
        [grantUid, tenantUid]
      );
      const manualVested = manualVestingRow && manualVestingRow.manualVested ? parseFloat(manualVestingRow.manualVested) : 0;
      vestedSharesReturned = vested + manualVested;
    } else {
      vestedSharesReturned = 0; // If retained, no vested shares are returned
    }
    // Prepare update
    const updateParams = [
      'inactive', // status
      terminationDate,
      unvestedShares, // always set
      vestedSharesReturned,
      userUid, // terminated_by
      currentGrant.version + 1, // version
      grantUid,
      tenantUid,
      currentGrant.version
    ];
    // Execute the update
    const updateResult = client.run(
      `UPDATE grant_record SET 
        status = ?, 
        inactive_effective_date = ?, 
        unvested_shares_returned = ?,
        vested_shares_returned = ?,
        terminated_by = ?,
        version = ?
       WHERE grant_uid = ? AND tenant_uid = ? AND version = ?`,
      updateParams
    );
    if (updateResult.changes === 0) {
      throw new Error('Grant has been modified by another user. Please refresh and try again.');
    }
    // Optionally store treatment (if you want to persist it, add a column)
    // For now, just log it in audit
    auditLog = {
      tenantUid,
      userUid,
      action: 'GRANT_TERMINATE',
      entityType: 'grant',
      entityUid: grantUid,
      details: {
        before: {
          status: 'active',
          version: currentGrant.version
        },
        after: {
          status: 'inactive',
          inactive_effective_date: terminationDate,
          unvested_shares_returned: unvestedShares,
          vested_shares_returned: vestedSharesReturned,
          treatment,
          version: currentGrant.version + 1
        }
      }
    };
    return getGrant(grantUid, tenantUid);
  };
  let result;
  if (externalClient) {
    result = runInTransaction(externalClient);
  } else {
    result = db.transaction(runInTransaction);
  }
  if (auditLog) audit.logAction(auditLog.tenantUid, auditLog.userUid, auditLog.action, auditLog.entityType, auditLog.entityUid, auditLog.details);
  return result;
}

/**
 * Soft delete a grant
 * @param {string} grantUid - UID of the grant to delete
 * @param {string} tenantUid - UID of the tenant
 * @param {number} version - Current version for optimistic locking
 * @param {string} userUid - UID of the user deleting the grant
 * @returns {boolean} Success indicator
 */
function deleteGrant(grantUid, tenantUid, version, userUid) {
  let auditLog = null;
  const result = db.transaction((client) => {
    // Get current grant data for audit and validation
    const currentGrant = client.get(
      'SELECT * FROM grant_record WHERE grant_uid = ? AND tenant_uid = ? AND deleted_at IS NULL',
      [grantUid, tenantUid]
    );
    if (!currentGrant) {
      throw new Error('Grant not found');
    }
    // Optimistic locking check
    if (version !== undefined && version !== currentGrant.version) {
      throw new Error('Grant has been modified by another user. Please refresh and try again.');
    }
    // Check if there are vesting events for this grant
    const vestingCount = client.get(
      'SELECT COUNT(*) as count FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ?',
      [grantUid, tenantUid]
    );
    if (vestingCount && vestingCount.count > 0) {
      throw new Error('Cannot delete a grant with vesting events');
    }
    // Soft delete the grant
    const updateResult = client.run(
      'UPDATE grant_record SET deleted_at = CURRENT_TIMESTAMP, version = ? WHERE grant_uid = ? AND tenant_uid = ? AND version = ?',
      [currentGrant.version + 1, grantUid, tenantUid, currentGrant.version]
    );
    if (updateResult.changes === 0) {
      throw new Error('Grant has been modified by another user. Please refresh and try again.');
    }
    auditLog = {
      tenantUid,
      userUid,
      action: 'GRANT_DELETE',
      entityType: 'grant',
      entityUid: grantUid,
      details: {
        before: {
          employee_uid: currentGrant.employee_uid,
          grant_date: currentGrant.grant_date,
          share_amount: currentGrant.share_amount,
          status: currentGrant.status,
          version: currentGrant.version
        }
      }
    };
    return true;
  });
  if (auditLog) audit.logAction(auditLog.tenantUid, auditLog.userUid, auditLog.action, auditLog.entityType, auditLog.entityUid, auditLog.details);
  return result;
}

/**
 * Add a manual vesting event to a grant
 * @param {string} grantUid - UID of the grant
 * @param {string} tenantUid - UID of the tenant
 * @param {Object} vestingData - Vesting data
 * @param {string} vestingData.vestDate - Date of vesting
 * @param {number} vestingData.sharesVested - Number of shares vested
 * @param {number} vestingData.version - Current version of grant for optimistic locking
 * @param {string} userUid - UID of the user adding the vesting event
 * @returns {Object} Updated grant data with new vesting event
 */
function addVestingEvent(grantUid, tenantUid, vestingData, userUid) {
  const { vestDate, sharesVested, version } = vestingData;
  // Look up the correct PPS for the vesting date (active/applicable on that date)
  const ppsSnapshot = vestingService.getPPSForVestDate(tenantUid, vestDate);
  console.log(`[VESTING] Using PPS ${ppsSnapshot} for vesting event on ${vestDate} (tenant ${tenantUid})`);
  // Validate share amount decimal precision
  if (!decimal.validateDecimalPrecision(sharesVested)) {
    throw new Error('Shares vested must have at most 3 decimal places');
  }
  if (parseFloat(sharesVested) <= 0) {
    throw new Error('Shares vested must be greater than zero');
  }
  let auditLog = null;
  const result = db.transaction((client) => {
    // Get current grant data for validation
    const currentGrant = client.get(
      'SELECT * FROM grant_record WHERE grant_uid = ? AND tenant_uid = ? AND deleted_at IS NULL',
      [grantUid, tenantUid]
    );
    if (!currentGrant) {
      throw new Error('Grant not found');
    }
    // Optimistic locking check
    if (version !== undefined && version !== currentGrant.version) {
      throw new Error('Grant has been modified by another user. Please refresh and try again.');
    }
    // Check if grant is active
    if (currentGrant.status !== 'active') {
      throw new Error('Cannot add vesting events to an inactive grant');
    }
    // Check if vesting would exceed total shares
    const newVestedTotal = decimal.add(currentGrant.vested_amount, sharesVested);
    if (parseFloat(newVestedTotal) > parseFloat(currentGrant.share_amount)) {
      throw new Error(`Vesting would exceed total shares. Total: ${currentGrant.share_amount}, Already vested: ${currentGrant.vested_amount}, New vesting: ${sharesVested}`);
    }
    // Create the vesting event
    client.run(
      `INSERT INTO vesting_event (
        grant_uid, tenant_uid, vest_date, shares_vested, pps_snapshot, created_by, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [grantUid, tenantUid, vestDate, sharesVested, ppsSnapshot, userUid, 'manual']
    );
    // Update the grant's vested amount
    const updateResult = client.run(
      'UPDATE grant_record SET vested_amount = ?, version = ? WHERE grant_uid = ? AND tenant_uid = ? AND version = ?',
      [newVestedTotal, currentGrant.version + 1, grantUid, tenantUid, currentGrant.version]
    );
    if (updateResult.changes === 0) {
      throw new Error('Grant has been modified by another user. Please refresh and try again.');
    }
    auditLog = {
      tenantUid,
      userUid,
      action: 'VESTING_EVENT_CREATE',
      entityType: 'grant',
      entityUid: grantUid,
      details: {
        before: {
          vested_amount: currentGrant.vested_amount,
          version: currentGrant.version
        },
        after: {
          vested_amount: newVestedTotal,
          version: currentGrant.version + 1,
          vesting_event: {
            vest_date: vestDate,
            shares_vested: sharesVested,
            pps_snapshot: ppsSnapshot
          }
        }
      }
    };
    return getGrant(grantUid, tenantUid);
  });
  if (auditLog) audit.logAction(auditLog.tenantUid, auditLog.userUid, auditLog.action, auditLog.entityType, auditLog.entityUid, auditLog.details);
  return result;
}

/**
 * Get employee grants summary
 * @param {string} employeeUid - UID of the employee
 * @param {string} tenantUid - UID of the tenant
 * @returns {Object} Grant summary for the employee
 */
function getEmployeeGrantsSummary(employeeUid, tenantUid) {
  const summary = db.get(
    `SELECT 
      COUNT(*) as total_grants,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_grants,
      SUM(CASE WHEN status = 'active' THEN share_amount ELSE 0 END) as total_active_shares,
      SUM(CASE WHEN status = 'active' THEN vested_amount ELSE 0 END) as total_vested_shares,
      SUM(unvested_shares_returned) as total_unvested_returned,
      SUM(vested_shares_returned) as total_vested_returned
    FROM grant_record
    WHERE employee_uid = ? AND tenant_uid = ? AND deleted_at IS NULL`,
    [employeeUid, tenantUid]
  );
  // Get boughtback shares from pool_event
  const boughtbackRow = db.get(
    `SELECT SUM(amount) as total_boughtback FROM pool_event WHERE employee_uid = ? AND tenant_uid = ? AND event_type = 'return_boughtback'`,
    [employeeUid, tenantUid]
  );
  if (!summary) {
    return {
      totalGrants: 0,
      activeGrants: 0,
      totalActiveShares: 0,
      totalVestedShares: 0,
      totalUnvestedShares: 0,
      returned: 0,
      returnedVested: 0,
      returnedUnvested: 0,
      returnedBoughtback: 0
    };
  }
  const totalUnvestedShares = decimal.subtract(
    summary.total_active_shares || 0,
    summary.total_vested_shares || 0
  );
  const returned = (summary.total_unvested_returned || 0) + (summary.total_vested_returned || 0);
  return {
    totalGrants: summary.total_grants,
    activeGrants: summary.active_grants,
    totalActiveShares: summary.total_active_shares || 0,
    totalVestedShares: summary.total_vested_shares || 0,
    totalUnvestedShares,
    returned,
    returnedVested: summary.total_vested_returned || 0,
    returnedUnvested: summary.total_unvested_returned || 0,
    returnedBoughtback: boughtbackRow && boughtbackRow.total_boughtback ? boughtbackRow.total_boughtback : 0
  };
}

/**
 * Buy back vested shares for a specific grant
 * @param {string} grantUid - UID of the grant
 * @param {string} tenantUid - UID of the tenant
 * @param {number} amount - Number of vested shares to buy back
 * @param {string} userUid - UID of the user performing the buyback
 * @returns {Object} Updated grant data
 */
function buybackVestedShares(grantUid, tenantUid, amount, userUid) {
  if (!amount || amount <= 0) {
    throw new Error('Buyback amount must be greater than zero');
  }
  return db.transaction((client) => {
    const grant = client.get(
      `SELECT grant_uid, vested_amount, vested_shares_returned, status, employee_uid FROM grant_record WHERE grant_uid = ? AND tenant_uid = ? AND deleted_at IS NULL`,
      [grantUid, tenantUid]
    );
    if (!grant) throw new Error('Grant not found');
    if (grant.status !== 'active') throw new Error('Buyback only allowed for active grants');
    const available = parseFloat(grant.vested_amount || 0) - parseFloat(grant.vested_shares_returned || 0);
    if (amount > available) {
      throw new Error(`Cannot buy back more than available vested shares (${available})`);
    }
    const newReturned = parseFloat(grant.vested_shares_returned || 0) + amount;
    client.run(
      `UPDATE grant_record SET vested_shares_returned = ? WHERE grant_uid = ? AND tenant_uid = ?`,
      [newReturned, grantUid, tenantUid]
    );
    audit.logAction(tenantUid, userUid, 'GRANT_VESTED_BUYBACK', 'grant', grantUid, {
      after: { vested_shares_returned: newReturned, buyback_amount: amount }
    });
    // Add pool event for buyback
    poolModel.returnSharesToPool(client, tenantUid, amount, 'return_boughtback', new Date().toISOString().split('T')[0], userUid, grant.employee_uid, grantUid);
    // Return updated grant
    return client.get(
      `SELECT * FROM grant_record WHERE grant_uid = ? AND tenant_uid = ?`,
      [grantUid, tenantUid]
    );
  });
}

/**
 * Buy back vested shares for an employee (prorated across all active grants)
 * @param {string} employeeUid - UID of the employee
 * @param {string} tenantUid - UID of the tenant
 * @param {number} amount - Number of vested shares to buy back
 * @param {string} userUid - UID of the user performing the buyback
 * @returns {Array} Breakdown of buyback per grant
 */
function buybackVestedSharesForEmployee(employeeUid, tenantUid, amount, userUid) {
  if (!amount || amount <= 0) {
    throw new Error('Buyback amount must be greater than zero');
  }
  return db.transaction((client) => {
    // Fetch all active grants for the employee
    const grants = client.all(
      `SELECT grant_uid, vested_amount, vested_shares_returned FROM grant_record WHERE employee_uid = ? AND tenant_uid = ? AND status = 'active' AND deleted_at IS NULL`,
      [employeeUid, tenantUid]
    );
    if (!grants || grants.length === 0) throw new Error('No active grants found for employee');
    // Calculate available vested shares per grant
    const availableList = grants.map(g => ({
      grantUid: g.grant_uid,
      available: parseFloat(g.vested_amount || 0) - parseFloat(g.vested_shares_returned || 0)
    }));
    const totalAvailable = availableList.reduce((sum, g) => sum + g.available, 0);
    if (amount > totalAvailable) {
      throw new Error(`Cannot buy back more than available vested shares (${totalAvailable})`);
    }
    // Prorate buyback
    let remaining = amount;
    const breakdown = availableList.map(g => ({ grantUid: g.grantUid, buyback: 0, available: g.available }));
    // First pass: proportional allocation
    let totalAllocated = 0;
    for (let i = 0; i < breakdown.length; i++) {
      if (remaining <= 0) break;
      const alloc = Math.floor((breakdown[i].available / totalAvailable) * amount);
      const toBuy = Math.min(alloc, breakdown[i].available, remaining);
      breakdown[i].buyback = toBuy;
      remaining -= toBuy;
      totalAllocated += toBuy;
    }
    // Distribute any remainder
    let idx = 0;
    while (remaining > 0) {
      if (breakdown[idx].available > breakdown[idx].buyback) {
        breakdown[idx].buyback += 1;
        remaining -= 1;
      }
      idx = (idx + 1) % breakdown.length;
    }
    // Update each grant
    for (const b of breakdown) {
      if (b.buyback > 0) {
        const grant = client.get(
          `SELECT vested_shares_returned, employee_uid FROM grant_record WHERE grant_uid = ? AND tenant_uid = ?`,
          [b.grantUid, tenantUid]
        );
        const newReturned = parseFloat(grant.vested_shares_returned || 0) + b.buyback;
        client.run(
          `UPDATE grant_record SET vested_shares_returned = ? WHERE grant_uid = ? AND tenant_uid = ?`,
          [newReturned, b.grantUid, tenantUid]
        );
        audit.logAction(tenantUid, userUid, 'EMPLOYEE_VESTED_BUYBACK', 'grant', b.grantUid, {
          after: { vested_shares_returned: newReturned, buyback_amount: b.buyback, employeeUid }
        });
        // Add pool event for buyback
        poolModel.returnSharesToPool(client, tenantUid, b.buyback, 'return_boughtback', new Date().toISOString().split('T')[0], userUid, grant.employee_uid, b.grantUid);
      }
    }
    return breakdown;
  });
}

module.exports = {
  getGrant,
  getGrants,
  countGrants,
  createGrant,
  updateGrant,
  terminateGrant,
  deleteGrant,
  addVestingEvent,
  getEmployeeGrantsSummary,
  buybackVestedShares,
  buybackVestedSharesForEmployee
}; 