/**
 * Chart Data Caching Service
 * Caches dashboard chart data to reduce database load
 */
const fs = require('fs');
const path = require('path');
const db = require('../db');
const decimal = require('../utils/decimal');

// Cache directory setup
const CACHE_DIR = path.join(__dirname, '..', '..', 'data', 'cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Cache file paths
const POOL_CACHE_FILE = path.join(CACHE_DIR, 'pool_chart_data.json');
const VESTING_CACHE_FILE = path.join(CACHE_DIR, 'vesting_chart_data.json');

// Cache expiry time (1 week in milliseconds)
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Write data to cache file
 * @param {string} filePath - Path to cache file
 * @param {Object} data - Data to cache
 */
function writeCache(filePath, data) {
  try {
    const cacheData = {
      timestamp: Date.now(),
      data: data
    };
    fs.writeFileSync(filePath, JSON.stringify(cacheData, null, 2));
    console.log(`Cache updated for ${path.basename(filePath)}`);
  } catch (err) {
    console.error(`Error writing cache to ${filePath}:`, err);
  }
}

/**
 * Read data from cache file
 * @param {string} filePath - Path to cache file
 * @returns {Object|null} - Cached data or null if cache is invalid
 */
function readCache(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const cacheData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      // Check if cache is expired
      if (Date.now() - cacheData.timestamp > CACHE_EXPIRY) {
        console.log(`Cache expired for ${path.basename(filePath)}`);
        return null;
      }
      
      return cacheData;
    }
  } catch (err) {
    console.error(`Error reading cache from ${filePath}:`, err);
  }
  
  return null;
}

/**
 * Get pool allocation chart data (from cache or database)
 * @param {string} tenantUid - Tenant UID
 * @param {boolean} forceRefresh - Force refresh cache
 * @returns {Object} - Chart data and metadata
 */
function getPoolChartData(tenantUid, forceRefresh = false) {
  // Try to get from cache first
  if (!forceRefresh) {
    const cache = readCache(POOL_CACHE_FILE);
    if (cache && cache.data.tenantUid === tenantUid) {
      return cache;
    }
  }
  
  // Get fresh data from database
  try {
    // Get pool metrics
    const pool = db.get(
      'SELECT pool_uid, initial_amount, total_pool FROM equity_pool WHERE tenant_uid = ? AND deleted_at IS NULL',
      [tenantUid]
    );
    
    // Calculate granted shares
    const grantedResult = db.get(
      `SELECT SUM(share_amount) as granted
      FROM grant_record
      WHERE tenant_uid = ? AND status = 'active' AND deleted_at IS NULL`,
      [tenantUid]
    );
    
    // Calculate returned unvested shares
    const returnedResult = db.get(
      `SELECT SUM(unvested_shares_returned) as returned
      FROM grant_record
      WHERE tenant_uid = ? AND status = 'inactive' AND deleted_at IS NULL`,
      [tenantUid]
    );
    
    // Calculate available shares
    const totalPool = pool ? parseFloat(pool.total_pool) : 0;
    const granted = grantedResult ? parseFloat(grantedResult.granted || 0) : 0;
    const returned = returnedResult ? parseFloat(returnedResult.returned || 0) : 0;
    const available = totalPool - granted + returned;
    
    // Prepare data
    const chartData = {
      tenantUid,
      totalPool,
      granted,
      returned,
      available
    };
    
    // Write to cache
    writeCache(POOL_CACHE_FILE, chartData);
    
    // Return with timestamp
    return {
      timestamp: Date.now(),
      data: chartData
    };
  } catch (err) {
    console.error('Error getting pool chart data:', err);
    return {
      timestamp: Date.now(),
      data: {
        tenantUid,
        totalPool: 0,
        granted: 0,
        returned: 0,
        available: 0,
        error: err.message
      }
    };
  }
}

/**
 * Get vesting chart data (from cache or database)
 * @param {string} tenantUid - Tenant UID
 * @param {boolean} forceRefresh - Force refresh cache
 * @returns {Object} - Chart data and metadata
 */
function getVestingChartData(tenantUid, forceRefresh = false) {
  // Try to get from cache first
  if (!forceRefresh) {
    const cache = readCache(VESTING_CACHE_FILE);
    if (cache && cache.data.tenantUid === tenantUid && Array.isArray(cache.data.quarters)) {
      console.log('[CHART DEBUG] Returning data from cache for getVestingChartData');
      return cache;
    }
  }
  console.log(`[CHART DEBUG] Calculating getVestingChartData for tenant: ${tenantUid}, forceRefresh: ${forceRefresh}`);

  try {
    // Calculate last 8 quarters
    const now = new Date();
    const quarters = [];
    let year = now.getFullYear();
    let quarter = Math.floor(now.getMonth() / 3) + 1;
    for (let i = 0; i < 8; i++) {
      quarters.unshift({
        label: `Q${quarter} ${year}`,
        year,
        quarter
      });
      quarter--;
      if (quarter === 0) {
        quarter = 4;
        year--;
      }
    }
    console.log('[CHART DEBUG] Generated quarters:', JSON.stringify(quarters));

    // For each quarter, calculate totals as of the end of that quarter
    const quarterData = quarters.map(q => {
      console.log(`[CHART DEBUG] Processing quarter: ${q.label} (Year: ${q.year}, Q: ${q.quarter})`);
      // End date of the quarter
      const endMonth = q.quarter * 3;
      const endDate = new Date(q.year, endMonth, 0, 23, 59, 59, 999); // last day of quarter
      // Convert endDate to YYYY-MM-DD string
      const endDateStr = endDate.toISOString().slice(0, 10);
      console.log(`[CHART DEBUG] Quarter ${q.label} - endDateStr: ${endDateStr}`);
      
      // Get all grants as of this date
      const grants = db.query(
        `SELECT grant_uid, share_amount, grant_date FROM grant_record WHERE tenant_uid = ? AND grant_date <= ? AND deleted_at IS NULL`,
        [tenantUid, endDateStr]
      );
      console.log(`[CHART DEBUG] Quarter ${q.label} - Grants found:`, JSON.stringify(grants));
      
      let totalGranted = 0;
      let totalVested = 0;
      
      grants.forEach(grant => {
        console.log(`[CHART DEBUG] Quarter ${q.label} - Processing grant_uid: ${grant.grant_uid}`);
        totalGranted += parseFloat(grant.share_amount || 0);
        // Sum all vesting events for this grant up to end of quarter
        const vestedRow = db.get(
          'SELECT SUM(shares_vested) as vested FROM vesting_event WHERE grant_uid = ? AND tenant_uid = ? AND vest_date <= ?',
          [grant.grant_uid, tenantUid, endDateStr]
        );
        console.log(`[CHART DEBUG] Quarter ${q.label} - Grant ${grant.grant_uid} - Vested row:`, JSON.stringify(vestedRow));
        totalVested += parseFloat(vestedRow && vestedRow.vested ? vestedRow.vested : 0);
      });
      
      const currentQuarterSummary = {
        quarter: q.label,
        granted: totalGranted,
        vested: totalVested,
        unvested: Math.max(0, totalGranted - totalVested)
      };
      console.log(`[CHART DEBUG] Quarter ${q.label} - Summary:`, JSON.stringify(currentQuarterSummary));
      return currentQuarterSummary;
    });

    console.log('[CHART DEBUG] Final quarterData for cache:', JSON.stringify(quarterData));
    // Prepare data
    const chartData = {
      tenantUid,
      quarters: quarterData
    };

    // Write to cache
    writeCache(VESTING_CACHE_FILE, chartData);
    console.log('[CHART DEBUG] Wrote final quarterData to cache.');

    // Return with timestamp
    return {
      timestamp: Date.now(),
      data: chartData
    };
  } catch (err) {
    console.error('[CHART DEBUG] Error in getVestingChartData:', err); // Added prefix
    return {
      timestamp: Date.now(),
      data: {
        tenantUid,
        quarters: [],
        error: err.message
      }
    };
  }
}

/**
 * Format timestamp to readable date
 * @param {number} timestamp - Unix timestamp (milliseconds)
 * @returns {string} - Formatted date string
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  });
}

/**
 * Get pool allocation chart data by quarter (for time series chart)
 * @param {string} tenantUid - Tenant UID
 * @param {boolean} forceRefresh - Force refresh cache
 * @returns {Object} - Chart data and metadata
 */
function getPoolChartDataByQuarter(tenantUid, forceRefresh = false) {
  const POOL_QUARTERS_CACHE_FILE = path.join(CACHE_DIR, 'pool_quarters_chart_data.json');
  if (!forceRefresh) {
    const cache = readCache(POOL_QUARTERS_CACHE_FILE);
    if (cache && cache.data.tenantUid === tenantUid && Array.isArray(cache.data.quarters)) {
      return cache;
    }
  }
  try {
    // Calculate last 8 quarters
    const now = new Date();
    const quarters = [];
    let year = now.getFullYear();
    let quarter = Math.floor(now.getMonth() / 3) + 1;
    for (let i = 0; i < 8; i++) {
      quarters.unshift({
        label: `Q${quarter} ${year}`,
        year,
        quarter
      });
      quarter--;
      if (quarter === 0) {
        quarter = 4;
        year--;
      }
    }
    // For each quarter, calculate totals as of the end of that quarter
    const quarterData = quarters.map(q => {
      const endMonth = q.quarter * 3;
      const endDate = new Date(q.year, endMonth, 0, 23, 59, 59, 999);
      const endDateStr = endDate.toISOString().slice(0, 10);
      // Get pool size as of this date
      const poolRow = db.get(
        `SELECT total_pool FROM equity_pool WHERE tenant_uid = ? AND deleted_at IS NULL`,
        [tenantUid]
      );
      const totalPool = poolRow ? parseFloat(poolRow.total_pool || 0) : 0;
      // Calculate granted shares as of this date
      const grantedRow = db.get(
        `SELECT SUM(share_amount) as granted FROM grant_record WHERE tenant_uid = ? AND grant_date <= ? AND deleted_at IS NULL`,
        [tenantUid, endDateStr]
      );
      const granted = grantedRow ? parseFloat(grantedRow.granted || 0) : 0;
      // Calculate returned unvested shares as of this date
      const returnedRow = db.get(
        `SELECT SUM(unvested_shares_returned) as returned FROM grant_record WHERE tenant_uid = ? AND inactive_effective_date <= ? AND deleted_at IS NULL`,
        [tenantUid, endDateStr]
      );
      const returned = returnedRow ? parseFloat(returnedRow.returned || 0) : 0;
      // Calculate available shares
      const available = totalPool - granted + returned;
      return {
        quarter: q.label,
        totalPool,
        granted,
        returned,
        available
      };
    });
    const chartData = {
      tenantUid,
      quarters: quarterData
    };
    writeCache(POOL_QUARTERS_CACHE_FILE, chartData);
    return {
      timestamp: Date.now(),
      data: chartData
    };
  } catch (err) {
    console.error('Error getting pool quarters chart data:', err);
    return {
      timestamp: Date.now(),
      data: {
        tenantUid,
        quarters: [],
        error: err.message
      }
    };
  }
}

module.exports = {
  getPoolChartData,
  getVestingChartData,
  formatTimestamp,
  getPoolChartDataByQuarter,
};
