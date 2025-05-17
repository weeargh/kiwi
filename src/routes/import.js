const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const csvParse = require('csv-parse/sync');
const { isAuthenticated, isAdmin } = require('../middlewares/auth');
const db = require('../db');
const poolModel = require('../models/pool');

// Multer setup for file uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }); // 2MB max

// Employee import template columns
const REQUIRED_COLUMNS = ['email', 'first_name', 'last_name'];

// Grant import template columns
const GRANT_REQUIRED_COLUMNS = ['email', 'grant_date', 'share_amount'];

// POST /import/employees
router.post('/employees', isAuthenticated, isAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }
    let rows = [];
    if (req.file.originalname.endsWith('.xlsx')) {
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    } else if (req.file.originalname.endsWith('.csv')) {
      rows = csvParse.parse(req.file.buffer.toString(), { columns: true, skip_empty_lines: true });
    } else {
      return res.status(400).json({ success: false, message: 'Unsupported file type.' });
    }
    // Validate columns
    const missingCols = REQUIRED_COLUMNS.filter(col => !Object.keys(rows[0] || {}).includes(col));
    if (missingCols.length > 0) {
      return res.status(400).json({ success: false, message: 'Missing required columns: ' + missingCols.join(', ') });
    }
    // Validate each row
    const errors = [];
    const validRows = [];
    const seenEmails = new Set();
    rows.forEach((row, idx) => {
      const rowNum = idx + 2; // header is row 1
      let rowErrors = [];
      REQUIRED_COLUMNS.forEach(col => {
        if (!row[col] || String(row[col]).trim() === '') {
          rowErrors.push(`${col} is required`);
        }
      });
      // Email format
      if (row.email && !/^\S+@\S+\.\S+$/.test(row.email)) {
        rowErrors.push('Invalid email format');
      }
      // Status
      row.status = 'active';
      // Duplicate in file
      if (seenEmails.has(row.email)) {
        rowErrors.push('Duplicate email in file');
      }
      seenEmails.add(row.email);
      if (rowErrors.length > 0) {
        errors.push({ row: rowNum, errors: rowErrors });
      } else {
        validRows.push(row);
      }
    });
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors });
    }
    // Preview only: do not insert yet
    return res.json({ success: true, preview: validRows, count: validRows.length });
  } catch (err) {
    console.error('Import error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /import/employees/commit
router.post('/employees/commit', isAuthenticated, isAdmin, (req, res) => {
  try {
    console.log('IMPORT COMMIT BODY:', req.body);
    const { employees } = req.body;
    const tenantUid = req.session.user.tenant_uid;
    const userUid = req.session.user.user_uid;
    if (!Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ success: false, message: 'No employees to import.', body: req.body });
    }
    const errors = [];
    let imported = 0;
    // Transaction for all-or-nothing import
    try {
      db.transaction((client) => {
        for (let i = 0; i < employees.length; i++) {
          const row = employees[i];
          // Validation
          const rowErrors = [];
          if (!row.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) rowErrors.push('Invalid or missing email');
          if (!row.first_name || row.first_name.length > 50) rowErrors.push('Invalid first name');
          if (!row.last_name || row.last_name.length > 50) rowErrors.push('Invalid last name');
          // Always set status to 'active'
          row.status = 'active';
          if (rowErrors.length) {
            errors.push({ row: i + 2, errors: rowErrors });
            continue;
          }
          // Check for existing employee by email and tenant
          const existing = client.get('SELECT employee_uid FROM employee WHERE tenant_uid = ? AND email = ? AND deleted_at IS NULL', [tenantUid, row.email]);
          if (existing) {
            // Update
            client.run('UPDATE employee SET first_name = ?, last_name = ?, status = ? WHERE employee_uid = ? AND tenant_uid = ?', [row.first_name, row.last_name, row.status, existing.employee_uid, tenantUid]);
          } else {
            // Insert
            client.run('INSERT INTO employee (employee_uid, tenant_uid, email, first_name, last_name, status) VALUES (?, ?, ?, ?, ?, ?)', [require('nanoid').nanoid(), tenantUid, row.email, row.first_name, row.last_name, row.status]);
          }
          imported++;
        }
        if (errors.length) {
          throw new Error('Validation errors');
        }
      });
    } catch (err) {
      console.error('Error during employee import transaction:', err, err.stack);
      if (errors.length) {
        return res.json({ success: false, message: 'Import failed due to validation errors.', errors });
      }
      return res.status(500).json({ success: false, message: 'Server error during import.', error: err.message });
    }
    return res.json({ success: true, message: 'Import successful.', count: imported });
  } catch (err) {
    console.error('IMPORT COMMIT ERROR:', err);
    res.status(500).json({ success: false, message: 'Server error during import.', error: err.message, stack: err.stack });
  }
});

// POST /import/grants (preview)
router.post('/grants', isAuthenticated, isAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }
    let rows = [];
    if (req.file.originalname.endsWith('.xlsx')) {
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    } else if (req.file.originalname.endsWith('.csv')) {
      rows = csvParse.parse(req.file.buffer.toString(), { columns: true, skip_empty_lines: true });
    } else {
      return res.status(400).json({ success: false, message: 'Unsupported file type.' });
    }
    // Validate columns
    const missingCols = GRANT_REQUIRED_COLUMNS.filter(col => !Object.keys(rows[0] || {}).includes(col));
    if (missingCols.length > 0) {
      return res.status(400).json({ success: false, message: 'Missing required columns: ' + missingCols.join(', ') });
    }
    // Validate each row
    const errors = [];
    const validRows = [];
    const seen = new Set();
    const tenantUid = req.session.user.tenant_uid;
    rows.forEach((row, idx) => {
      const rowNum = idx + 2; // header is row 1
      let rowErrors = [];
      // Required fields
      GRANT_REQUIRED_COLUMNS.forEach(col => {
        if (!row[col] || String(row[col]).trim() === '') {
          rowErrors.push(`${col} is required`);
        }
      });
      // Email format
      if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
        rowErrors.push('Invalid email format');
      }
      // Date format
      if (row.grant_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.grant_date)) {
        rowErrors.push('Invalid grant_date format (expected YYYY-MM-DD)');
      }
      // Share amount
      if (row.share_amount && (isNaN(row.share_amount) || Number(row.share_amount) <= 0)) {
        rowErrors.push('share_amount must be a positive number');
      }
      // Duplicate in file (email+grant_date)
      const key = `${row.email}|${row.grant_date}`;
      if (seen.has(key)) {
        rowErrors.push('Duplicate grant for this employee and date in file');
      }
      seen.add(key);
      // Check employee exists
      let employee = null;
      if (row.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
        employee = db.get('SELECT employee_uid FROM employee WHERE tenant_uid = ? AND email = ? AND deleted_at IS NULL', [tenantUid, row.email]);
        if (!employee) {
          rowErrors.push('Employee not found for this email');
        }
      }
      if (rowErrors.length > 0) {
        errors.push({ row: rowNum, errors: rowErrors });
      } else {
        validRows.push({
          email: row.email,
          grant_date: row.grant_date,
          share_amount: Number(row.share_amount),
          employee_uid: employee.employee_uid
        });
      }
    });
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors });
    }
    // Preview only: do not insert yet
    return res.json({ success: true, preview: validRows, count: validRows.length });
  } catch (err) {
    console.error('Grant import preview error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /import/grants/commit
router.post('/grants/commit', isAuthenticated, isAdmin, (req, res) => {
  try {
    const { grants } = req.body;
    const tenantUid = req.session.user.tenant_uid;
    const userUid = req.session.user.user_uid;
    if (!Array.isArray(grants) || grants.length === 0) {
      return res.status(400).json({ success: false, message: 'No grants to import.', body: req.body });
    }
    const errors = [];
    let imported = 0;
    let insertedGrantUids = [];
    try {
      // Validate pool shares before import
      const pool = poolModel.getPool(tenantUid);
      const available = Number(pool && pool.available || 0);
      const totalImporting = grants.reduce((sum, row) => sum + Number(row.share_amount || 0), 0);
      if (totalImporting > available) {
        return res.status(400).json({
          success: false,
          message: `Import would exceed available pool shares. Available: ${available}, Importing: ${totalImporting}`
        });
      }
      db.transaction((client) => {
        for (let i = 0; i < grants.length; i++) {
          const row = grants[i];
          const rowErrors = [];
          // Validate again (defensive)
          if (!row.employee_uid) rowErrors.push('Missing employee_uid');
          if (!row.grant_date || !/^\d{4}-\d{2}-\d{2}$/.test(row.grant_date)) rowErrors.push('Invalid grant_date');
          if (!row.share_amount || isNaN(row.share_amount) || Number(row.share_amount) <= 0) rowErrors.push('Invalid share_amount');
          if (rowErrors.length) {
            errors.push({ row: i + 2, errors: rowErrors });
            continue;
          }
          // Check for duplicate grant (employee_uid + grant_date)
          const existing = client.get('SELECT grant_uid FROM grant_record WHERE tenant_uid = ? AND employee_uid = ? AND grant_date = ? AND deleted_at IS NULL', [tenantUid, row.employee_uid, row.grant_date]);
          if (existing) {
            errors.push({ row: i + 2, errors: ['Duplicate grant for this employee and date (already exists in DB)'] });
            continue;
          }
          // Insert grant
          const newGrantUid = require('nanoid').nanoid();
          client.run('INSERT INTO grant_record (grant_uid, tenant_uid, employee_uid, grant_date, share_amount, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [newGrantUid, tenantUid, row.employee_uid, row.grant_date, row.share_amount, 'active', userUid]);
          insertedGrantUids.push({ grantUid: newGrantUid, row, rowNum: i + 2 });
          imported++;
        }
        if (errors.length) {
          throw new Error('Validation errors');
        }
      });
      // Now process vesting for each inserted grant (outside transaction)
      const vestingService = require('../services/vesting');
      const dateUtils = require('../utils/date');
      const timezone = req.session.user.timezone || 'UTC';
      for (const { grantUid, row, rowNum } of insertedGrantUids) {
        try {
          vestingService.processBackdatedVesting(
            grantUid,
            tenantUid,
            row.grant_date,
            timezone,
            userUid
          );
        } catch (vestingErr) {
          console.error('Vesting calculation failed for imported grant', grantUid, vestingErr);
          errors.push({ row: rowNum, errors: ['Vesting calculation failed: ' + vestingErr.message] });
        }
      }
    } catch (err) {
      console.error('Error during grant import transaction:', err, err.stack);
      if (errors.length) {
        return res.json({ success: false, message: 'Import failed due to validation errors.', errors });
      }
      return res.status(500).json({ success: false, message: 'Server error during import.', error: err.message });
    }
    return res.json({ success: true, message: 'Import successful.', count: imported, errors: errors.length ? errors : undefined });
  } catch (err) {
    console.error('GRANT IMPORT COMMIT ERROR:', err);
    res.status(500).json({ success: false, message: 'Server error during import.', error: err.message, stack: err.stack });
  }
});

module.exports = router; 