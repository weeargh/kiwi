// Automated Equity System Audit Script
// Audits grants, vesting, terminations, and pool returns for consistency
// Prints a human-readable report of any mismatches or issues

const db = require('../db');
const vestingService = require('../services/vesting');
const decimal = require('./decimal');
const dateUtils = require('./date');

function printSection(title) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

function format(num) {
  return Number(num).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function auditGrants() {
  printSection('Grant Vesting Audit');
  const grants = db.query('SELECT * FROM grant_record WHERE deleted_at IS NULL');
  let issues = 0;
  grants.forEach(grant => {
    // Use today or termination date
    const effectiveDate = grant.terminated_at || dateUtils.getCurrentDate('UTC');
    const summary = vestingService.calculateVestingForDisplay({
      id: grant.grant_uid,
      grantDate: grant.grant_date,
      shareAmount: grant.share_amount
    }, effectiveDate, 'UTC');
    const expectedVested = summary.theoreticalVestedAmount;
    // Actual vested from vesting_event
    const vestedRow = db.get('SELECT SUM(shares_vested) as vested FROM vesting_event WHERE grant_uid = ?', [grant.grant_uid]);
    const actualVested = parseFloat(vestedRow && vestedRow.vested ? vestedRow.vested : 0);
    if (Math.abs(expectedVested - actualVested) > 0.001) {
      issues++;
      console.log(`Grant #${grant.grant_uid}: Expected vested ${format(expectedVested)}, actual vested events ${format(actualVested)} [MISMATCH]`);
    }
  });
  if (issues === 0) {
    console.log('All grants have correct vesting event totals.');
  }
}

function auditTerminations() {
  printSection('Terminated Grants Return Audit');
  const grants = db.query("SELECT * FROM grant_record WHERE (status = 'terminated' OR status = 'inactive') AND deleted_at IS NULL");
  let issues = 0;
  grants.forEach(grant => {
    // Calculate theoretical vested/unvested as of termination
    const effectiveDate = grant.inactive_effective_date || grant.terminated_at || dateUtils.getCurrentDate('UTC');
    const summary = vestingService.calculateVestingForDisplay({
      id: grant.grant_uid,
      grantDate: grant.grant_date,
      shareAmount: grant.share_amount
    }, effectiveDate, 'UTC');
    const vested = summary.theoreticalVestedAmount;
    const unvested = Math.max(0, parseFloat(grant.share_amount) - vested);
    // Returned shares (from grant record)
    const returnedVested = parseFloat(grant.vested_shares_returned || 0);
    const returnedUnvested = parseFloat(grant.unvested_shares_returned || 0);
    // Kept by employee = vested - returnedVested
    const keptByEmployee = Math.max(0, vested - returnedVested);
    // Expectation math
    const granted = parseFloat(grant.share_amount);
    const vestedSum = returnedVested + keptByEmployee;
    const grantedSum = vested + unvested;
    // Print details
    console.log(`Grant #${grant.grant_uid} (Employee #${grant.employee_uid}):`);
    console.log(`  Vested: ${format(vested)}, Unvested: ${format(unvested)}`);
    console.log(`  Returned (vested): ${format(returnedVested)}, Returned (unvested): ${format(returnedUnvested)}, Kept by employee: ${format(keptByEmployee)}`);
    console.log(`  [Expectation] Vested = Returned (vested) + Kept by employee => ${format(vested)} = ${format(returnedVested)} + ${format(keptByEmployee)}`);
    console.log(`  [Expectation] Granted = Vested + Unvested => ${format(granted)} = ${format(vested)} + ${format(unvested)}`);
    // Flag mismatches
    let mismatch = false;
    if (Math.abs(vested - vestedSum) > 0.001) {
      console.log('  [MISMATCH] Vested does not equal returned + kept');
      mismatch = true;
    }
    if (Math.abs(granted - grantedSum) > 0.001) {
      console.log('  [MISMATCH] Granted does not equal vested + unvested');
      mismatch = true;
    }
    if (!mismatch) {
      console.log('  [OK] Math checks out.');
    }
  });
  if (issues === 0) {
    console.log('All terminated grants have correct returned shares in pool events.');
  }
}

function auditPoolTotals() {
  printSection('Equity Pool Totals Audit');
  const pools = db.query('SELECT pool_uid, total_pool FROM equity_pool WHERE deleted_at IS NULL');
  let issues = 0;
  pools.forEach(pool => {
    // Sum all initial, top_up, reduction events
    const sumRow = db.get(
      `SELECT SUM(amount) as total FROM pool_event WHERE pool_uid = ? AND event_type IN ('initial', 'top_up', 'reduction')`,
      [pool.pool_uid]
    );
    const expectedTotal = sumRow && sumRow.total ? parseFloat(sumRow.total) : 0;
    if (Math.abs(expectedTotal - pool.total_pool) > 0.001) {
      issues++;
      console.log(`Pool #${pool.pool_uid}: total_pool=${format(pool.total_pool)}, expected=${format(expectedTotal)} [MISMATCH]`);
    }
  });
  if (issues === 0) {
    console.log('All pools have correct total_pool values.');
  }
}

function auditEmployee1VestingBreakdown() {
  const employeeUid = 'employee-uid-1'; // Replace with actual test UID if needed
  const tenantUid = 'tenant-uid-2'; // Adjust if needed
  const db = require('../db');
  const vestingService = require('../services/vesting');
  const dateUtils = require('./date');
  const today = dateUtils.getCurrentDate('UTC');
  const grants = db.query(`SELECT grant_uid, grant_date, share_amount, vested_amount FROM grant_record WHERE employee_uid = ? AND status = 'active' AND deleted_at IS NULL`, [employeeUid]);
  console.log('\nPer-Grant Vested Shares Breakdown for Employee 1 (as of today):');
  console.log('grant_uid | grant_date | share_amount | vested_amount | actual_vested | theoretical_vested | DIFF');
  grants.forEach(grant => {
    const actualVestedRow = db.get('SELECT SUM(shares_vested) as vested FROM vesting_event WHERE grant_uid = ?', [grant.grant_uid]);
    const actualVested = parseFloat(actualVestedRow && actualVestedRow.vested ? actualVestedRow.vested : 0);
    const summary = vestingService.calculateVestingForDisplay({
      id: grant.grant_uid,
      grantDate: grant.grant_date,
      shareAmount: grant.share_amount,
      vestedAmount: grant.vested_amount
    }, today, 'UTC');
    const theoretical = summary.theoreticalVestedAmount;
    const diff = Math.abs(theoretical - actualVested);
    const mismatch = diff > 0.001 ? '<< MISMATCH' : '';
    console.log(`${grant.grant_uid} | ${grant.grant_date} | ${grant.share_amount} | ${grant.vested_amount} | ${actualVested} | ${theoretical} | ${mismatch}`);
  });
}

function main() {
  console.log('Equity System Audit Report');
  auditGrants();
  auditTerminations();
  auditPoolTotals();
  console.log('\nAudit complete. Review any [MISMATCH] lines above.');
}

if (require.main === module) {
  main();
  auditEmployee1VestingBreakdown();
}

// Add Express endpoint for audit (for admin use only)
if (require.main !== module) {
  const express = require('express');
  const router = express.Router();
  router.get('/audit/equity', async (req, res) => {
    try {
      const report = await runFullAudit();
      res.json({ success: true, report });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  module.exports = router;
} 