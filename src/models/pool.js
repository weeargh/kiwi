const db = require('../db');
const decimal = require('../utils/decimal');
const audit = require('../utils/audit');
const { nanoid } = require('nanoid');

/**
 * Get equity pool for a tenant
 * @param {string} tenantUid - UID of the tenant
 * @returns {Promise<Object>} Pool data with metrics
 */
function getPool(tenantUid) {
  const pool = db.get(
    'SELECT pool_uid, initial_amount, total_pool FROM equity_pool WHERE tenant_uid = ? AND deleted_at IS NULL',
    [tenantUid]
  );
  if (!pool) return null;
  const grantedResult = db.get(
    `SELECT SUM(share_amount) as granted
     FROM grant_record
     WHERE tenant_uid = ? AND status = 'active' AND deleted_at IS NULL`,
    [tenantUid]
  );
  const returnedResult = db.get(
    `SELECT 
       SUM(unvested_shares_returned) as unvested,
       SUM(vested_shares_returned) as vested
     FROM grant_record
     WHERE tenant_uid = ? AND deleted_at IS NULL`,
    [tenantUid]
  );
  const granted = grantedResult.granted || 0;
  const unvested = returnedResult.unvested || 0;
  const vested = returnedResult.vested || 0;
  const returned = unvested + vested;
  const keptByEmployee = getKeptByEmployeeShares(tenantUid);
  const available = decimal.subtract(
    pool.total_pool,
    decimal.add(granted, keptByEmployee)
  );
  return {
    uid: pool.pool_uid,
    initialAmount: pool.initial_amount,
    totalPool: pool.total_pool,
    granted,
    returned,
    unvestedSharesReturned: unvested,
    vestedSharesReturned: vested,
    keptByEmployee,
    available
  };
}

/**
 * Create a new equity pool
 * @param {string} tenantUid - UID of the tenant
 * @param {number} initialAmount - Initial pool amount
 * @param {string} effectiveDate - Effective date for the pool
 * @param {string} userUid - UID of the user creating the pool
 * @returns {Promise<Object>} Created pool data
 */
function createPool(tenantUid, initialAmount, effectiveDate, userUid) {
  let auditLog = null;
  const result = db.transaction((client) => {
    const poolUid = nanoid(12);
    client.run(
      `INSERT INTO equity_pool (
        pool_uid, tenant_uid, initial_amount, total_pool, created_by
      ) VALUES (?, ?, ?, ?, ?)`,
      [poolUid, tenantUid, initialAmount, initialAmount, userUid]
    );
    client.run(
      `INSERT INTO pool_event (
        pool_uid, tenant_uid, amount, event_type, effective_date, created_by
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [poolUid, tenantUid, initialAmount, 'initial', effectiveDate, userUid]
    );
    auditLog = {
      tenantUid,
      userUid,
      action: 'POOL_CREATE',
      entityType: 'pool',
      entityUid: poolUid,
      details: {
        after: {
          initialAmount,
          effectiveDate
        }
      }
    };
    return {
      uid: poolUid,
      initialAmount,
      totalPool: initialAmount,
      granted: 0,
      returned: 0,
      unvestedSharesReturned: 0,
      vestedSharesReturned: 0,
      available: initialAmount
    };
  });
  if (auditLog) audit.logAction(auditLog.tenantUid, auditLog.userUid, auditLog.action, auditLog.entityType, auditLog.entityUid, auditLog.details);
  return result;
}

/**
 * Add a pool event (top-up or reduction)
 * @param {string} poolUid - UID of the pool
 * @param {string} tenantUid - UID of the tenant
 * @param {number} amount - Amount to add or reduce (positive for top-up, negative for reduction)
 * @param {string} eventType - Type of event ('top_up' or 'reduction')
 * @param {string} effectiveDate - Effective date for the event
 * @param {string} notes - Optional notes about the event
 * @param {string} userUid - UID of the user creating the event
 * @returns {Promise<Object>} Updated pool data
 */
function addPoolEvent(poolUid, tenantUid, amount, eventType, effectiveDate, notes, userUid) {
  let auditLog = null;
  const result = db.transaction((client) => {
    const pool = client.get(
      'SELECT pool_uid, total_pool FROM equity_pool WHERE pool_uid = ? AND tenant_uid = ? AND deleted_at IS NULL',
      [poolUid, tenantUid]
    );
    if (!pool) throw new Error('Equity pool not found');
    if (eventType === 'top_up' && amount <= 0) throw new Error('Top-up amount must be positive');
    if (eventType === 'reduction' && amount >= 0) throw new Error('Reduction amount must be negative');
    const newTotal = decimal.add(pool.total_pool, amount);
    const metrics = getPoolMetrics(client, tenantUid);
    const newAvailable = decimal.subtract(
      decimal.add(newTotal, metrics.returned || 0),
      metrics.granted || 0
    );
    if (newAvailable < 0) throw new Error('Cannot reduce pool below committed grants. Available shares must be ≥ 0.');
    client.run(
      'UPDATE equity_pool SET total_pool = ? WHERE pool_uid = ?',
      [newTotal, poolUid]
    );
    const eventResult = client.run(
      `INSERT INTO pool_event (
        pool_uid, tenant_uid, amount, event_type, effective_date, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [poolUid, tenantUid, amount, eventType, effectiveDate, notes, userUid]
    );
    auditLog = {
      tenantUid,
      userUid,
      action: 'POOL_EVENT',
      entityType: 'pool',
      entityUid: poolUid,
      details: {
        after: {
          amount,
          eventType,
          effectiveDate,
          notes
        }
      }
    };
    return {
      uid: poolUid,
      eventId: eventResult.lastInsertRowid || eventResult.id,
      totalPool: newTotal,
      granted: metrics.granted || 0,
      returned: metrics.returned || 0,
      unvestedSharesReturned: metrics.unvestedSharesReturned || 0,
      vestedSharesReturned: metrics.vestedSharesReturned || 0,
      available: newAvailable
    };
  });
  if (auditLog) audit.logAction(auditLog.tenantUid, auditLog.userUid, auditLog.action, auditLog.entityType, auditLog.entityUid, auditLog.details);
  return result;
}

/**
 * Get pool events history
 * @param {string} poolUid - UID of the pool
 * @param {string} tenantUid - UID of the tenant
 * @returns {Promise<Array>} List of pool events
 */
function getPoolEvents(poolUid, tenantUid) {
  const events = db.query(
    `SELECT 
       e.event_uid, 
       e.amount, 
       e.event_type, 
       e.effective_date, 
       e.notes, 
       e.created_at,
       u.name as created_by_name
     FROM pool_event e
     JOIN user_account u ON e.created_by = u.user_uid
     WHERE e.pool_uid = ? AND e.tenant_uid = ?
     ORDER BY e.created_at DESC`,
    [poolUid, tenantUid]
  );
  if (!Array.isArray(events)) return events ? [events] : [];
  return events;
}

/**
 * Helper function to get pool metrics
 * @param {Object} client - Database connection or transaction
 * @param {string} tenantUid - UID of the tenant
 * @returns {Promise<Object>} Pool metrics
 */
function getPoolMetrics(client, tenantUid) {
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
     WHERE tenant_uid = ? AND deleted_at IS NULL`,
    [tenantUid]
  );
  const unvested = returnedResult.unvested || 0;
  const vested = returnedResult.vested || 0;
  const returned = unvested + vested;
  console.log('[POOL DEBUG] (metrics) granted:', grantedResult.granted || 0, 'unvested:', unvested, 'vested:', vested, 'returned:', returned);
  return {
    granted: grantedResult.granted || 0,
    returned,
    unvestedSharesReturned: unvested,
    vestedSharesReturned: vested
  };
}

// Return shares to pool (used in grant termination)
// Now accepts employeeId and grantId for traceability
function returnSharesToPool(client, tenantUid, amount, eventType, effectiveDate, userUid, employeeUid = null, grantUid = null) {
  console.log(`[POOL DEBUG] returnSharesToPool called with amount=${amount}, eventType=${eventType}, tenantUid=${tenantUid}, effectiveDate=${effectiveDate}, userUid=${userUid}, employeeUid=${employeeUid}, grantUid=${grantUid}`);
  if (!amount || amount <= 0) return;
  // Find pool_id for this tenant
  const pool = client.get('SELECT pool_uid FROM equity_pool WHERE tenant_uid = ? AND deleted_at IS NULL', [tenantUid]);
  if (!pool) throw new Error('Equity pool not found');
  // Only update total_pool for top_up, reduction, initial
  if (["top_up", "reduction", "initial"].includes(eventType)) {
    client.run('UPDATE equity_pool SET total_pool = total_pool + ? WHERE tenant_uid = ? AND deleted_at IS NULL', [amount, tenantUid]);
  }
  // Log pool event with employee and grant info for return events
  client.run(
    `INSERT INTO pool_event (pool_uid, tenant_uid, amount, event_type, effective_date, created_by, employee_uid, grant_uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [pool.pool_uid, tenantUid, amount, eventType, effectiveDate, userUid, employeeUid, grantUid]
  );
}

/**
 * Get total shares kept by terminated/inactive employees (vested but not returned)
 * @param {string} tenantUid - UID of the tenant
 * @returns {number} Total kept by employee
 */
function getKeptByEmployeeShares(tenantUid) {
  // For each terminated/inactive grant: kept = sum of vested shares up to effective date - vested_shares_returned
  const grants = db.query(
    `SELECT grant_uid, grant_date, share_amount, vested_shares_returned, status, inactive_effective_date, terminated_at
     FROM grant_record
     WHERE tenant_uid = ? AND (status = 'terminated' OR status = 'inactive') AND deleted_at IS NULL`,
    [tenantUid]
  );
  let totalKept = 0;
  grants.forEach(grant => {
    const effectiveDate = grant.inactive_effective_date || grant.terminated_at;
    if (!effectiveDate) return;
    // Sum actual vested shares from vesting_event up to and including the effective date
    const vestedRow = db.get(
      `SELECT SUM(shares_vested) as vested FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ? AND vest_date <= ?`,
      [grant.grant_uid, tenantUid, effectiveDate]
    );
    const vested = parseFloat(vestedRow && vestedRow.vested ? vestedRow.vested : 0);
    const returnedVested = parseFloat(grant.vested_shares_returned || 0);
    const kept = Math.max(0, vested - returnedVested);
    console.log(`[KEPT DEBUG] grant_uid=${grant.grant_uid} vested=${vested} vested_shares_returned=${returnedVested} kept=${kept} effectiveDate=${effectiveDate}`);
    totalKept += kept;
  });
  console.log(`[KEPT DEBUG] tenantUid=${tenantUid} totalKeptByEmployee=${totalKept}`);
  return totalKept;
}

module.exports = {
  getPool,
  createPool,
  addPoolEvent,
  getPoolEvents,
  returnSharesToPool,
  getKeptByEmployeeShares
}; 