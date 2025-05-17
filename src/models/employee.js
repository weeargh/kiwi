const db = require('../db');
const audit = require('../utils/audit');
const grantModel = require('./grant');
const { nanoid } = require('nanoid');

console.log('employee.js loaded');

/**
 * Get an employee by UID
 * @param {string} employeeUid - UID of the employee
 * @param {string} tenantUid - UID of the tenant
 * @returns {Object} Employee data or null if not found
 */
function getEmployee(employeeUid, tenantUid) {
  const employee = db.get(
    `SELECT 
      employee_uid, tenant_uid, email, first_name, last_name, status, created_at, termination_effective_date
     FROM employee 
     WHERE employee_uid = ? AND tenant_uid = ? AND deleted_at IS NULL`,
    [employeeUid, tenantUid]
  );
  
  if (!employee) {
    return null;
  }
  
  return {
    uid: employee.employee_uid,
    tenantUid: employee.tenant_uid,
    email: employee.email,
    firstName: employee.first_name,
    lastName: employee.last_name,
    status: employee.status,
    createdAt: employee.created_at,
    terminationEffectiveDate: employee.termination_effective_date
  };
}

/**
 * Get all employees for a tenant
 * @param {string} tenantUid - UID of the tenant
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of records to return
 * @param {number} options.offset - Offset for pagination
 * @param {string} options.status - Filter by status
 * @returns {Array} List of employee records
 */
function getEmployees(tenantUid, options = {}) {
  const { 
    limit = 50, 
    offset = 0, 
    status = null,
    search = null
  } = options;
  
  let query = `
    SELECT 
      e.employee_uid, 
      e.email, 
      e.first_name, 
      e.last_name, 
      e.status, 
      e.created_at,
      e.termination_effective_date,
      (SELECT COUNT(*) FROM grant_record g 
       WHERE g.employee_uid = e.employee_uid 
         AND g.tenant_uid = e.tenant_uid 
         AND g.status = 'active' 
         AND g.deleted_at IS NULL) as active_grants_count
    FROM employee e
    WHERE e.tenant_uid = ? AND e.deleted_at IS NULL
  `;
  
  const params = [tenantUid];
  
  if (status && ['active', 'inactive', 'terminated'].includes(status)) {
    query += ' AND e.status = ?';
    params.push(status);
  }
  
  if (search) {
    query += ` AND (
      e.email LIKE ? OR 
      e.first_name LIKE ? OR 
      e.last_name LIKE ?
    )`;
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam, searchParam);
  }
  
  query += ' ORDER BY e.last_name ASC, e.first_name ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  const employees = db.query(query, params);
  if (!Array.isArray(employees)) return employees ? [employees] : [];
  return employees.map(employee => ({
    uid: employee.employee_uid,
    email: employee.email,
    firstName: employee.first_name,
    lastName: employee.last_name,
    status: employee.status,
    createdAt: employee.created_at,
    terminationEffectiveDate: employee.termination_effective_date,
    activeGrantsCount: employee.active_grants_count
  }));
}

/**
 * Count total employees for pagination
 * @param {string} tenantUid - UID of the tenant
 * @param {Object} options - Query options
 * @param {string} options.status - Filter by status
 * @param {string} options.search - Search query
 * @returns {number} Total count of employees
 */
function countEmployees(tenantUid, options = {}) {
  const { status = null, search = null } = options;
  
  let query = 'SELECT COUNT(*) as count FROM employee WHERE tenant_uid = ? AND deleted_at IS NULL';
  const params = [tenantUid];
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  if (search) {
    query += ` AND (
      email LIKE ? OR 
      first_name LIKE ? OR 
      last_name LIKE ?
    )`;
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam, searchParam);
  }
  
  const result = db.get(query, params);
  return result ? result.count : 0;
}

/**
 * Create a new employee
 * @param {string} tenantUid - UID of the tenant
 * @param {Object} employeeData - Employee data
 * @param {string} employeeData.email - Employee email
 * @param {string} employeeData.firstName - Employee first name
 * @param {string} employeeData.lastName - Employee last name
 * @param {string} employeeData.status - Employee status ('active' or 'inactive')
 * @param {string} userUid - UID of the user creating the employee
 * @returns {Object} Created employee data
 */
function createEmployee(tenantUid, employeeData, userUid, auditLog = null) {
  console.log('CREATE EMPLOYEE CALLED', { tenantUid, employeeData, userUid });
  const { email, firstName, lastName, status = 'active' } = employeeData;
  const result = db.transaction((client) => {
    // Check email uniqueness inside transaction
    const existingEmployee = client.get(
      'SELECT employee_uid FROM employee WHERE tenant_uid = ? AND email = ? AND deleted_at IS NULL',
      [tenantUid, email]
    );
    if (existingEmployee) {
      throw new Error(`An employee with email ${email} already exists`);
    }
    // Create the employee
    const employeeUid = nanoid(12);
    client.run(
      `INSERT INTO employee (
        employee_uid, tenant_uid, email, first_name, last_name, status
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [employeeUid, tenantUid, email, firstName, lastName, status]
    );
    if (auditLog) {
      auditLog.entityUid = employeeUid;
    }
    else {
      auditLog = {
        tenantUid,
        userUid,
        action: 'EMPLOYEE_CREATE',
        entityType: 'employee',
        entityUid: employeeUid,
        details: {
          after: {
            email,
            first_name: firstName,
            last_name: lastName,
            status
          }
        }
      };
    }
    return {
      uid: employeeUid,
      tenantUid,
      email,
      firstName,
      lastName,
      status,
      createdAt: new Date().toISOString()
    };
  });
  if (auditLog) {
    console.log('[AUDIT DEBUG] createEmployee auditLog:', auditLog);
    audit.logAction(auditLog.tenantUid, auditLog.userUid, auditLog.action, auditLog.entityType, auditLog.entityUid, auditLog.details);
  }
  return result;
}

/**
 * Update an employee
 * @param {string} employeeUid - UID of the employee to update
 * @param {string} tenantUid - UID of the tenant
 * @param {Object} updates - Fields to update
 * @param {string} updates.email - Employee email
 * @param {string} updates.firstName - Employee first name
 * @param {string} updates.lastName - Employee last name
 * @param {string} updates.status - Employee status
 * @param {string} userUid - UID of the user updating the employee
 * @returns {Object} Updated employee data
 */
function updateEmployee(employeeUid, tenantUid, updates, userUid) {
  let auditLog = null;
  const result = db.transaction((client) => {
    // Get current employee data for audit and validation using client
    const currentEmployee = client.get(
      `SELECT 
        employee_uid, tenant_uid, email, first_name, last_name, status, created_at
       FROM employee 
       WHERE employee_uid = ? AND tenant_uid = ? AND deleted_at IS NULL`,
      [employeeUid, tenantUid]
    );
    if (!currentEmployee) {
      throw new Error('Employee not found');
    }
    // Format current employee data to match our model
    const formattedEmployee = {
      uid: currentEmployee.employee_uid,
      tenantUid: currentEmployee.tenant_uid,
      email: currentEmployee.email,
      firstName: currentEmployee.first_name,
      lastName: currentEmployee.last_name,
      status: currentEmployee.status,
      createdAt: currentEmployee.created_at
    };
    // Check email uniqueness if it's being updated
    if (updates.email && updates.email !== formattedEmployee.email) {
      const existingEmployee = client.get(
        'SELECT employee_uid FROM employee WHERE tenant_uid = ? AND email = ? AND employee_uid != ? AND deleted_at IS NULL',
        [tenantUid, updates.email, employeeUid]
      );
      if (existingEmployee) {
        throw new Error(`An employee with email ${updates.email} already exists`);
      }
    }
    // Prepare update fields
    const updateFields = [];
    const updateParams = [];
    const updateData = {};
    if (updates.email !== undefined) {
      updateFields.push('email = ?');
      updateParams.push(updates.email);
      updateData.email = updates.email;
    }
    if (updates.firstName !== undefined) {
      updateFields.push('first_name = ?');
      updateParams.push(updates.firstName);
      updateData.first_name = updates.firstName;
    }
    if (updates.lastName !== undefined) {
      updateFields.push('last_name = ?');
      updateParams.push(updates.lastName);
      updateData.last_name = updates.lastName;
    }
    if (updates.status !== undefined) {
      updateFields.push('status = ?');
      updateParams.push(updates.status);
      updateData.status = updates.status;
    }
    // If there are no updates, return the current data
    if (updateFields.length === 0) {
      return formattedEmployee;
    }
    // Add the WHERE clause parameters
    updateParams.push(employeeUid, tenantUid);
    // Execute the update
    client.run(
      `UPDATE employee SET ${updateFields.join(', ')} 
       WHERE employee_uid = ? AND tenant_uid = ?`,
      updateParams
    );
    auditLog = {
      tenantUid,
      userUid,
      action: 'EMPLOYEE_UPDATE',
      entityType: 'employee',
      entityUid: employeeUid,
      details: {
        before: {
          email: formattedEmployee.email,
          first_name: formattedEmployee.firstName,
          last_name: formattedEmployee.lastName,
          status: formattedEmployee.status
        },
        after: updateData
      }
    };
    // Return updated employee data
    return {
      ...formattedEmployee,
      ...{
        email: updates.email !== undefined ? updates.email : formattedEmployee.email,
        firstName: updates.firstName !== undefined ? updates.firstName : formattedEmployee.firstName,
        lastName: updates.lastName !== undefined ? updates.lastName : formattedEmployee.lastName,
        status: updates.status !== undefined ? updates.status : formattedEmployee.status
      }
    };
  });
  if (auditLog) audit.logAction(auditLog.tenantUid, auditLog.userUid, auditLog.action, auditLog.entityType, auditLog.entityUid, auditLog.details);
  return result;
}

/**
 * Soft delete an employee
 * @param {string} employeeUid - UID of the employee to delete
 * @param {string} tenantUid - UID of the tenant
 * @param {string} userUid - UID of the user deleting the employee
 * @returns {boolean} Success indicator
 */
function deleteEmployee(employeeUid, tenantUid, userUid) {
  let auditLog = null;
  const result = db.transaction((client) => {
    // Get current employee data for audit using client
    const employee = client.get(
      `SELECT 
        employee_uid, tenant_uid, email, first_name, last_name, status, created_at
       FROM employee 
       WHERE employee_uid = ? AND tenant_uid = ? AND deleted_at IS NULL`,
      [employeeUid, tenantUid]
    );
    if (!employee) {
      throw new Error('Employee not found');
    }
    // Format employee data
    const formattedEmployee = {
      uid: employee.employee_uid,
      tenantUid: employee.tenant_uid,
      email: employee.email,
      firstName: employee.first_name,
      lastName: employee.last_name,
      status: employee.status,
      createdAt: employee.created_at
    };
    // Check if employee has active grants
    const grantCount = client.get(
      `SELECT COUNT(*) as count 
       FROM grant_record 
       WHERE employee_uid = ? AND tenant_uid = ? AND status = 'active' AND deleted_at IS NULL`,
      [employeeUid, tenantUid]
    );
    if (grantCount && grantCount.count > 0) {
      throw new Error('Cannot delete employee with active grants');
    }
    // Soft delete the employee
    client.run(
      'UPDATE employee SET deleted_at = CURRENT_TIMESTAMP WHERE employee_uid = ? AND tenant_uid = ?',
      [employeeUid, tenantUid]
    );
    auditLog = {
      tenantUid,
      userUid,
      action: 'EMPLOYEE_DELETE',
      entityType: 'employee',
      entityUid: employeeUid,
      details: {
        before: {
          email: formattedEmployee.email,
          first_name: formattedEmployee.firstName,
          last_name: formattedEmployee.lastName,
          status: formattedEmployee.status
        }
      }
    };
    return true;
  });
  if (auditLog) audit.logAction(auditLog.tenantUid, auditLog.userUid, auditLog.action, auditLog.entityType, auditLog.entityUid, auditLog.details);
  return result;
}

/**
 * Get employees with their grant summary
 * @param {string} tenantUid - UID of the tenant
 * @param {Object} options - Query options
 * @returns {Array} Employees with grant summary
 */
function getEmployeesWithGrantSummary(tenantUid, options = {}) {
  const { limit = 50, offset = 0, status = 'active', search = null, sort = 'first_name_asc' } = options;
  let query = `
    SELECT 
      e.employee_uid, 
      e.email, 
      e.first_name, 
      e.last_name, 
      e.status, 
      e.created_at,
      COUNT(g.grant_uid) as grant_count,
      SUM(CASE WHEN g.status = 'active' THEN g.share_amount ELSE 0 END) as total_shares,
      SUM(CASE WHEN g.status = 'active' THEN g.vested_amount ELSE 0 END) as vested_shares
    FROM employee e
    LEFT JOIN grant_record g ON e.employee_uid = g.employee_uid AND e.tenant_uid = g.tenant_uid AND g.deleted_at IS NULL
    WHERE e.tenant_uid = ? AND e.deleted_at IS NULL
  `;
  const params = [tenantUid];
  if (status && ['active', 'inactive', 'terminated'].includes(status)) {
    query += ' AND e.status = ?';
    params.push(status);
  }
  if (search) {
    query += ` AND (
      e.email LIKE ? OR 
      e.first_name LIKE ? OR 
      e.last_name LIKE ?
    )`;
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam, searchParam);
  }
  let orderBy = '';
  switch (sort) {
    case 'last_name_asc':
      orderBy = 'ORDER BY TRIM(LOWER(e.last_name)) ASC, TRIM(LOWER(e.first_name)) ASC';
      break;
    case 'last_name_desc':
      orderBy = 'ORDER BY TRIM(LOWER(e.last_name)) DESC, TRIM(LOWER(e.first_name)) DESC';
      break;
    case 'first_name_desc':
      orderBy = 'ORDER BY TRIM(LOWER(e.first_name)) DESC, TRIM(LOWER(e.last_name)) DESC';
      break;
    case 'first_name_asc':
    default:
      orderBy = 'ORDER BY TRIM(LOWER(e.first_name)) ASC, TRIM(LOWER(e.last_name)) ASC';
      break;
  }
  query += ` GROUP BY e.employee_uid\n    ${orderBy}\n    LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  const employees = db.query(query, params);
  if (!Array.isArray(employees)) return employees ? [employees] : [];
  return employees.map(e => ({
    uid: e.employee_uid,
    email: e.email,
    firstName: e.first_name,
    lastName: e.last_name,
    status: e.status,
    createdAt: e.created_at,
    grantCount: e.grant_count,
    totalShares: e.total_shares || 0,
    vestedShares: e.vested_shares || 0,
    vestedPercent: e.total_shares > 0 ? Math.round((e.vested_shares / e.total_shares) * 100) : 0
  }));
}

/**
 * Terminate an employee and all their active grants
 * @param {string} employeeUid - UID of the employee
 * @param {string} tenantUid - UID of the tenant
 * @param {Object} terminationData - { termination_effective_date, treatment_for_vested, reason }
 * @param {string} userUid - UID of the admin performing the termination
 * @returns {Object} { employee, terminatedGrants }
 */
function terminateEmployee(employeeUid, tenantUid, terminationData, userUid) {
  const { termination_effective_date, treatment_for_vested, reason } = terminationData;
  let terminatedGrants = [];
  let updatedEmployee = null;

  db.transaction((client) => {
    // Get all active grants for the employee
    const activeGrants = client.all(
      'SELECT * FROM grant_record WHERE employee_uid = ? AND tenant_uid = ? AND status = ? AND deleted_at IS NULL',
      [employeeUid, tenantUid, 'active']
    );
    if (!activeGrants || activeGrants.length === 0) {
      throw new Error('No active grants to terminate for this employee.');
    }

    // Terminate each grant
    for (const grant of activeGrants) {
      const result = grantModel.terminateGrant(
        grant.grant_uid,
        tenantUid,
        {
          terminationDate: termination_effective_date,
          reason,
          treatment: treatment_for_vested,
          version: grant.version
        },
        userUid,
        client
      );
      terminatedGrants.push(result);
      audit.logAction(tenantUid, userUid, 'GRANT_TERMINATE', 'grant', grant.grant_uid, {
        before: grant,
        after: result
      });
    }

    // Set employee status and inactive fields
    client.run(
      'UPDATE employee SET status = ?, inactive_effective_date = ?, inactive_reason = ?, version = version + 1 WHERE employee_uid = ? AND tenant_uid = ? AND deleted_at IS NULL',
      ['terminated', termination_effective_date, reason, employeeUid, tenantUid]
    );
    // Get updated employee
    const employee = client.get(
      'SELECT * FROM employee WHERE employee_uid = ? AND tenant_uid = ? AND deleted_at IS NULL',
      [employeeUid, tenantUid]
    );
    updatedEmployee = employee;
    audit.logAction(tenantUid, userUid, 'EMPLOYEE_TERMINATE', 'employee', employeeUid, {
      before: { status: 'active' },
      after: { status: employee.status, inactive_effective_date: termination_effective_date, inactive_reason: reason }
    });
  })();
  return { employee: updatedEmployee, terminatedGrants };
}

/**
 * Generate and store a 6-digit passcode for employee login
 * @param {string} tenantUid
 * @param {string} employeeUid
 * @param {string} email
 * @param {number} expiresInMinutes
 * @returns {string} passcode
 */
function createEmployeePasscode(tenantUid, employeeUid, email, expiresInMinutes = 10) {
  const passcode = (Math.floor(100000 + Math.random() * 900000)).toString();
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60000).toISOString();
  db.run(
    `INSERT INTO employee_passcode_login (tenant_uid, employee_uid, email, passcode, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [tenantUid, employeeUid, email, passcode, expiresAt]
  );
  return passcode;
}

/**
 * Verify a passcode for employee login
 * @param {string} tenantUid
 * @param {string} email
 * @param {string} passcode
 * @returns {boolean} true if valid, false otherwise
 */
function verifyEmployeePasscode(tenantUid, email, passcode) {
  const row = db.get(
    `SELECT id, expires_at, used FROM employee_passcode_login WHERE tenant_uid = ? AND email = ? AND passcode = ? ORDER BY expires_at DESC LIMIT 1`,
    [tenantUid, email, passcode]
  );
  if (!row) return false;
  if (row.used) return false;
  if (new Date(row.expires_at) < new Date()) return false;
  db.run(`UPDATE employee_passcode_login SET used = 1 WHERE id = ?`, [row.id]);
  return true;
}

module.exports = {
  getEmployee,
  getEmployees,
  countEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployeesWithGrantSummary,
  terminateEmployee,
  createEmployeePasscode,
  verifyEmployeePasscode,
}; 