const db = require('../db');
const decimal = require('../utils/decimal');
const dateUtils = require('../utils/date');
const audit = require('../utils/audit');
const vestingService = require('../services/vesting');
const { nanoid } = require('nanoid');

/**
 * Get the current price per share for a tenant
 * @param {string} tenantUid - UID of the tenant
 * @returns {Object} Current PPS data or null if not found
 */
function getCurrentPPS(tenantUid) {
  const pps = db.get(
    `SELECT 
      pps_uid, 
      effective_date, 
      price_per_share,
      created_at,
      created_by
    FROM pps_history 
    WHERE tenant_uid = ? AND effective_date <= date('now') AND deleted_at IS NULL
    ORDER BY effective_date DESC, created_at DESC 
    LIMIT 1`,
    [tenantUid]
  );
  if (!pps) return null;
  return {
    uid: pps.pps_uid,
    effectiveDate: pps.effective_date,
    pricePerShare: pps.price_per_share,
    createdAt: pps.created_at,
    createdBy: pps.created_by
  };
}

/**
 * Get the price per share effective on a specific date
 * @param {string} tenantUid - UID of the tenant
 * @param {string} date - Date to get PPS for (YYYY-MM-DD)
 * @returns {Object} PPS data or null if not found
 */
function getPPSForDate(tenantUid, date) {
  const pps = db.get(
    `SELECT 
      pps_uid, 
      effective_date, 
      price_per_share,
      created_at,
      created_by
    FROM pps_history 
    WHERE tenant_uid = ? AND effective_date <= ? AND deleted_at IS NULL
    ORDER BY effective_date DESC, created_at DESC 
    LIMIT 1`,
    [tenantUid, date]
  );
  if (!pps) return null;
  return {
    uid: pps.pps_uid,
    effectiveDate: pps.effective_date,
    pricePerShare: pps.price_per_share,
    createdAt: pps.created_at,
    createdBy: pps.created_by
  };
}

/**
 * Get PPS history for a tenant
 * @param {string} tenantUid - UID of the tenant
 * @param {number} limit - Maximum number of records to return
 * @param {number} offset - Offset for pagination
 * @returns {Array} List of PPS records
 */
function getPPSHistory(tenantUid, limit = 50, offset = 0) {
  const history = db.query(
    `SELECT 
      p.pps_uid, 
      p.effective_date, 
      p.price_per_share,
      p.created_at,
      u.name as created_by_name
    FROM pps_history p
    JOIN user_account u ON p.created_by = u.user_uid
    WHERE p.tenant_uid = ? AND p.deleted_at IS NULL
    ORDER BY p.effective_date DESC, p.created_at DESC
    LIMIT ? OFFSET ?`,
    [tenantUid, limit, offset]
  );
  if (!Array.isArray(history)) return history ? [history] : [];
  return history;
}

/**
 * Count total PPS records for pagination
 * @param {string} tenantUid - UID of the tenant
 * @returns {number} Total count of PPS records
 */
function countPPSHistory(tenantUid) {
  const result = db.get(
    'SELECT COUNT(*) as count FROM pps_history WHERE tenant_uid = ? AND deleted_at IS NULL',
    [tenantUid]
  );
  return result ? result.count : 0;
}

/**
 * Create a new PPS record
 * @param {string} tenantUid - UID of the tenant
 * @param {number} pricePerShare - Price per share value
 * @param {string} effectiveDate - Date when the PPS becomes effective
 * @param {string} userUid - UID of the user creating the record
 * @returns {Object} Created PPS data
 */
function createPPS(tenantUid, pricePerShare, effectiveDate, userUid) {
  if (!decimal.validateDecimalPrecision(pricePerShare)) {
    throw new Error('Price per share must have at most 3 decimal places');
  }
  if (parseFloat(pricePerShare) <= 0) {
    throw new Error('Price per share must be greater than zero');
  }
  let auditLog = null;
  const result = db.transaction((client) => {
    const ppsUid = nanoid(12);
    client.run(
      `INSERT INTO pps_history (
        pps_uid, tenant_uid, effective_date, price_per_share, created_by
      ) VALUES (?, ?, ?, ?, ?)`,
      [ppsUid, tenantUid, effectiveDate, pricePerShare, userUid]
    );
    auditLog = {
      tenantUid,
      userUid,
      action: 'PPS_CREATE',
      entityType: 'pps',
      entityUid: ppsUid,
      details: {
        after: {
          effective_date: effectiveDate,
          price_per_share: pricePerShare
        }
      }
    };
    return {
      uid: ppsUid,
      effectiveDate,
      pricePerShare,
      createdAt: new Date().toISOString(),
      createdBy: userUid
    };
  });
  if (auditLog) audit.logAction(auditLog.tenantUid, auditLog.userUid, auditLog.action, auditLog.entityType, auditLog.entityUid, auditLog.details);
  return result;
}

/**
 * Soft delete a PPS record
 * @param {string} ppsUid - UID of the PPS record to delete
 * @param {string} tenantUid - UID of the tenant
 * @param {string} userUid - UID of the user deleting the record
 * @returns {boolean} Success indicator
 */
function deletePPS(ppsUid, tenantUid, userUid) {
  let auditLog = null;
  const result = db.transaction((client) => {
    const pps = client.get(
      'SELECT * FROM pps_history WHERE pps_uid = ? AND tenant_uid = ? AND deleted_at IS NULL',
      [ppsUid, tenantUid]
    );
    if (!pps) {
      throw new Error('PPS record not found');
    }
    client.run(
      'UPDATE pps_history SET deleted_at = CURRENT_TIMESTAMP WHERE pps_uid = ?',
      [ppsUid]
    );
    auditLog = {
      tenantUid,
      userUid,
      action: 'PPS_DELETE',
      entityType: 'pps',
      entityUid: ppsUid,
      details: {
        before: {
          effective_date: pps.effective_date,
          price_per_share: pps.price_per_share
        }
      }
    };
    return true;
  });
  if (auditLog) audit.logAction(auditLog.tenantUid, auditLog.userUid, auditLog.action, auditLog.entityType, auditLog.entityUid, auditLog.details);
  return result;
}

/**
 * Refresh PPS for all vesting events for a tenant
 * @param {string} tenantUid
 * @returns {number} Number of vesting events updated
 */
function refreshVestingEventPPS(tenantUid) {
  const events = db.query(
    'SELECT vesting_uid, vest_date, tenant_uid FROM vesting_event WHERE tenant_uid = ?',
    [tenantUid]
  );
  let updated = 0;
  events.forEach(event => {
    const correctPPS = vestingService.getPPSForVestDate(tenantUid, event.vest_date);
    const current = db.get('SELECT pps_snapshot FROM vesting_event WHERE vesting_uid = ?', [event.vesting_uid]);
    console.log(`[PPS DEBUG] Vesting UID: ${event.vesting_uid}, Vest Date: ${event.vest_date}, Correct PPS: ${correctPPS}, Current Snapshot: ${current ? current.pps_snapshot : 'N/A'}`);
    if (current && current.pps_snapshot !== correctPPS) {
      db.run('UPDATE vesting_event SET pps_snapshot = ? WHERE vesting_uid = ?', [correctPPS, event.vesting_uid]);
      console.log(`[PPS DEBUG] Updated vesting_uid ${event.vesting_uid} with PPS ${correctPPS}`);
      updated++;
    } else {
      console.log(`[PPS DEBUG] No update needed for vesting_uid ${event.vesting_uid}`);
    }
  });
  return updated;
}

module.exports = {
  getCurrentPPS,
  getPPSForDate,
  getPPSHistory,
  countPPSHistory,
  createPPS,
  deletePPS,
  refreshVestingEventPPS
}; 