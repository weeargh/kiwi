const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middlewares/auth');
const audit = require('../utils/audit');

// GET /audit-logs - Audit log page (admin only)
router.get('/', isAuthenticated, isAdmin, (req, res) => {
  // Use tenant_uid from session for admin
  const tenantId = req.session.user ? req.session.user.tenant_uid : null;
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const filters = {
    user: req.query.user || '',
    action: req.query.action || '',
    from: req.query.from || '',
    to: req.query.to || ''
  };
  // Build filter object for audit util
  const auditFilters = {};
  if (filters.user) auditFilters.userName = filters.user;
  if (filters.action) auditFilters.action = filters.action;
  if (filters.from) auditFilters.fromDate = filters.from;
  if (filters.to) auditFilters.toDate = filters.to;
  // Debug log
  console.log('Fetching audit logs for tenantId:', tenantId, 'filters:', auditFilters);
  // Fetch logs
  const result = audit.getAuditLogs(tenantId, auditFilters, page, limit);
  res.render('audit-logs', {
    title: 'Audit Logs',
    logs: result.items,
    pagination: result.pagination,
    filters
  });
});

module.exports = router; 