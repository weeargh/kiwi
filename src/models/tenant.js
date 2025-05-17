const db = require('../db');

/**
 * Get tenant display decimal places (for frontend display only)
 * @param {string} tenantUid
 * @returns {number} display_decimal_places (0-3)
 */
function getDisplayDecimalPlaces(tenantUid) {
  const row = db.get('SELECT display_decimal_places FROM tenant WHERE tenant_uid = ?', [tenantUid]);
  return row ? row.display_decimal_places : 0;
}

/**
 * Set tenant display decimal places (for frontend display only)
 * @param {string} tenantUid
 * @param {number} dp (0-3)
 */
function setDisplayDecimalPlaces(tenantUid, dp) {
  if (dp < 0 || dp > 3) dp = 0;
  db.run('UPDATE tenant SET display_decimal_places = ? WHERE tenant_uid = ?', [dp, tenantUid]);
}

/**
 * Set tenant display decimal places and/or company name
 * @param {string} tenantUid
 * @param {object} settings - { display_decimal_places, company_name }
 */
function setTenantSettings(tenantUid, settings) {
  const fields = [];
  const params = [];
  if (settings.display_decimal_places !== undefined) {
    let dp = settings.display_decimal_places;
    if (dp < 0 || dp > 3) dp = 0;
    fields.push('display_decimal_places = ?');
    params.push(dp);
  }
  if (settings.company_name !== undefined && settings.company_name !== null) {
    fields.push('name = ?');
    params.push(settings.company_name);
  }
  if (fields.length === 0) return;
  params.push(tenantUid);
  db.run(`UPDATE tenant SET ${fields.join(', ')} WHERE tenant_uid = ?`, params);
}

module.exports = {
  getDisplayDecimalPlaces,
  setDisplayDecimalPlaces,
  setTenantSettings
}; 