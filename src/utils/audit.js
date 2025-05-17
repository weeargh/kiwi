/**
 * Audit logging utility for the RSU/ESOP Platform.
 * Records user actions for compliance and audit trail purposes.
 */

const db = require('../db');

/**
 * Log an action in the audit log (synchronous)
 * @param {string} tenantUid - Tenant UID
 * @param {string} userUid - User UID who performed the action, can be null for system actions
 * @param {string} action - Type of action being performed (e.g. GRANT_CREATE, USER_LOGIN)
 * @param {string} objectType - Type of entity being affected (e.g. grant, user, employee)
 * @param {string} objectUid - UID of the entity being affected
 * @param {Object} details - Additional details about the action (before/after state)
 * @param {string} status - Status of the action (e.g. success, failure)
 * @param {string} ip - IP address of the user
 * @param {string} userAgent - User agent of the user
 * @param {string} userName - Name of the user
 * @param {string} userRole - Role of the user
 * @returns {Object} - Result of the insert operation
 */
function logAction(tenantUid, userUid, action, objectType, objectUid, details, status = 'success', ip = null, userAgent = null, userName = null, userRole = null) {
  // Validation for required fields
  if (!tenantUid || !action || !objectType || typeof objectUid === 'undefined' || objectUid === null || !status) {
    console.warn('[AUDIT] Missing required audit log fields:', {
      tenantUid, userUid, action, objectType, objectUid, status, details, ip, userAgent, userName, userRole
    });
    return { error: 'Missing required audit log fields' };
  }
  try {
    let beforeData = null;
    let afterData = null;
    if (details) {
      if (typeof details !== 'object') {
        throw new Error('Audit log details must be an object');
      }
      beforeData = details.before ? JSON.stringify(details.before) : null;
      afterData = details.after ? JSON.stringify(details.after) : null;
    }
    const result = db.run(
      `INSERT INTO audit_log 
      (tenant_uid, user_uid, user_name, user_role, action_type, entity_type, entity_uid, before_data, after_data, status, ip_address, user_agent) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantUid, userUid, userName, userRole, action, objectType, objectUid, beforeData, afterData, status, ip, userAgent]
    );
    return result;
  } catch (error) {
    console.error('Error logging audit event:', error);
    return { error: error.message };
  }
}

/**
 * Log a data change with before/after states (synchronous)
 * @param {string} tenantUid - Tenant UID
 * @param {string} userUid - User UID who performed the action
 * @param {string} actionType - Type of action being performed
 * @param {string} entityType - Type of entity being affected
 * @param {string} entityUid - UID of the entity being affected
 * @param {Object} beforeState - State of the entity before the change
 * @param {Object} afterState - State of the entity after the change
 * @returns {Object} - Result of the insert operation
 */
function logChange(tenantUid, userUid, actionType, entityType, entityUid, beforeState, afterState) {
  return logAction(tenantUid, userUid, actionType, entityType, entityUid, {
    before: beforeState,
    after: afterState
  });
}

/**
 * Log a creation action (no before state, synchronous)
 * @param {string} tenantUid - Tenant UID
 * @param {string} userUid - User UID who performed the action
 * @param {string} actionType - Type of action being performed
 * @param {string} entityType - Type of entity being created
 * @param {string} entityUid - UID of the entity being created
 * @param {Object} entityData - Data of the created entity
 * @returns {Object} - Result of the insert operation
 */
function logCreation(tenantUid, userUid, actionType, entityType, entityUid, entityData) {
  return logAction(tenantUid, userUid, actionType, entityType, entityUid, {
    before: null,
    after: entityData
  });
}

/**
 * Log a deletion action (no after state, synchronous)
 * @param {string} tenantUid - Tenant UID
 * @param {string} userUid - User UID who performed the action
 * @param {string} actionType - Type of action being performed
 * @param {string} entityType - Type of entity being deleted
 * @param {string} entityUid - UID of the entity being deleted
 * @param {Object} entityData - Data of the deleted entity
 * @returns {Object} - Result of the insert operation
 */
function logDeletion(tenantUid, userUid, actionType, entityType, entityUid, entityData) {
  return logAction(tenantUid, userUid, actionType, entityType, entityUid, {
    before: entityData,
    after: null
  });
}

/**
 * Retrieve audit logs with pagination and filtering (synchronous)
 * @param {string} tenantUid - Tenant UID
 * @param {Object} filters - Filtering options
 * @param {number} page - Page number
 * @param {number} limit - Records per page
 * @returns {Object} - Paginated audit logs
 */
function getAuditLogs(tenantUid, filters = {}, page = 1, limit = 20) {
  try {
    const offset = (page - 1) * limit;
    let query = `
      SELECT 
        log_id, 
        tenant_uid, 
        user_uid, 
        action_type, 
        entity_type, 
        entity_uid, 
        details, 
        created_at
      FROM audit_log
      WHERE tenant_uid = ?
    `;
    const params = [tenantUid];
    if (filters.actionType) {
      query += ` AND action_type = ?`;
      params.push(filters.actionType);
    }
    if (filters.entityType) {
      query += ` AND entity_type = ?`;
      params.push(filters.entityType);
    }
    if (filters.entityUid) {
      query += ` AND entity_uid = ?`;
      params.push(filters.entityUid);
    }
    if (filters.userUid) {
      query += ` AND user_uid = ?`;
      params.push(filters.userUid);
    }
    if (filters.fromDate) {
      query += ` AND DATE(created_at) >= DATE(?)`;
      params.push(filters.fromDate);
    }
    if (filters.toDate) {
      query += ` AND DATE(created_at) <= DATE(?)`;
      params.push(filters.toDate);
    }
    const countQuery = `SELECT COUNT(*) as total ${query.substring(query.indexOf('FROM'))}`;
    const countResult = db.get(countQuery, params);
    const totalItems = countResult.total;
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    const items = db.query(query, params);
    const parsedItems = items.map(item => {
      if (item.details) {
        try {
          item.details = JSON.parse(item.details);
        } catch (e) {
          item.details = { error: 'Invalid JSON' };
        }
      }
      return item;
    });
    return {
      items: parsedItems,
      pagination: {
        total_items: totalItems,
        total_pages: Math.ceil(totalItems / limit),
        current_page: page,
        limit: limit,
        next_page: page * limit < totalItems ? page + 1 : null,
        prev_page: page > 1 ? page - 1 : null
      }
    };
  } catch (error) {
    console.error('Error retrieving audit logs:', error);
    throw error;
  }
}

module.exports = {
  logAction,
  logChange,
  logCreation,
  logDeletion,
  getAuditLogs
}; 