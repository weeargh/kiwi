// Utility to format numbers for tenant display
// value: string or number, tenantDp: 0, 1, 2, or 3
function formatForTenantDisplay(value, tenantDp) {
  if (tenantDp < 0 || tenantDp > 3) tenantDp = 3; // fallback safety
  return Number(value).toFixed(tenantDp);
}

module.exports = { formatForTenantDisplay }; 