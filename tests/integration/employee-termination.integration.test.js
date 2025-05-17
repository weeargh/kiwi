const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/db');
const { setupTestTenant, createTestEmployee, createTestGrant, loginAsAdmin, fastForwardDate, createTestEmployeeAndGrant, fastForwardVesting, getPoolInfo, getGrantInfo } = require('../utils/test-setup');

describe('Employee Termination Integration', () => {
  let tenantId, adminCookie, employeeId, grantIds;

  beforeAll(async () => {
    // Setup tenant and admin
    ({ tenantId, adminCookie } = await setupTestTenant());
    // Create employee
    employeeId = await createTestEmployee(tenantId, { status: 'active' });
    // Create two active grants
    grantIds = [
      await createTestGrant(tenantId, employeeId, { shareAmount: 100, grantDate: '2024-01-01' }),
      await createTestGrant(tenantId, employeeId, { shareAmount: 50, grantDate: '2024-02-01' })
    ];
  });

  afterAll(() => {
    db.close();
  });

  test('Terminate employee with multiple active grants', async () => {
    const res = await request(app)
      .post(`/employees/${employeeId}/terminate`)
      .set('Cookie', adminCookie)
      .send({
        termination_effective_date: '2024-06-01',
        treatment_for_vested: 'keep',
        reason: 'Resignation'
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    // All grants should be inactive
    const grants = db.query('SELECT status, termination_date FROM grant_record WHERE employee_id = ?', [employeeId]);
    grants.forEach(g => {
      expect(g.status).toBe('inactive');
      expect(g.termination_date).toBe('2024-06-01');
    });
    // Employee should be inactive
    const emp = db.get('SELECT status FROM employee WHERE employee_id = ?', [employeeId]);
    expect(emp.status).toBe('inactive');
  });

  test('No vesting events after termination effective date', async () => {
    // Try to create vesting event after termination date
    const futureDate = '2024-07-01';
    const grantId = grantIds[0];
    expect(() => {
      db.run('INSERT INTO vesting_event (grant_id, tenant_id, vest_date, shares_vested, pps_snapshot, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [grantId, tenantId, futureDate, 10, 1.0, 1]);
    }).toThrow();
  });

  test('Audit logs are created for termination', () => {
    const logs = db.query('SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ?', ['employee', employeeId]);
    expect(logs.length).toBeGreaterThan(0);
    const grantLogs = db.query('SELECT * FROM audit_log WHERE entity_type = ? AND entity_id IN (?, ?)', ['grant', grantIds[0], grantIds[1]]);
    expect(grantLogs.length).toBeGreaterThan(0);
  });

  test('Edge case: employee with already-terminated grants', async () => {
    // Create new employee with one active, one inactive grant
    const emp2 = await createTestEmployee(tenantId, { status: 'active' });
    const g1 = await createTestGrant(tenantId, emp2, { shareAmount: 10, grantDate: '2024-01-01' });
    const g2 = await createTestGrant(tenantId, emp2, { shareAmount: 20, grantDate: '2024-02-01' });
    // Manually terminate g2
    db.run('UPDATE grant_record SET status = ?, termination_date = ? WHERE grant_id = ?', ['inactive', '2024-03-01', g2]);
    // Terminate employee
    const res = await request(app)
      .post(`/employees/${emp2}/terminate`)
      .set('Cookie', adminCookie)
      .send({
        termination_effective_date: '2024-06-01',
        treatment_for_vested: 'forfeit',
        reason: 'Layoff'
      });
    expect(res.statusCode).toBe(200);
    // Both grants should be inactive
    const grants = db.query('SELECT status FROM grant_record WHERE employee_id = ?', [emp2]);
    grants.forEach(g => expect(g.status).toBe('inactive'));
  });

  test('Edge case: future-dated termination keeps employee active until date', async () => {
    // Create new employee and grant
    const emp3 = await createTestEmployee(tenantId, { status: 'active' });
    const g3 = await createTestGrant(tenantId, emp3, { shareAmount: 10, grantDate: '2024-01-01' });
    // Terminate with future date
    const res = await request(app)
      .post(`/employees/${emp3}/terminate`)
      .set('Cookie', adminCookie)
      .send({
        termination_effective_date: '2099-12-31',
        treatment_for_vested: 'keep',
        reason: 'Retirement'
      });
    expect(res.statusCode).toBe(200);
    // Employee should remain active until the date passes (simulate date logic if needed)
    const emp = db.get('SELECT status FROM employee WHERE employee_id = ?', [emp3]);
    expect(emp.status).toBe('active'); // Or implement logic to check date
  });

  it('should update pool returned and available shares with both unvested and vested shares after buyback termination', async () => {
    // Setup: create employee, grant, and terminate with buyback
    const { employeeId, grantId } = await createTestEmployeeAndGrant({ tenantId });
    // Fast-forward vesting to vest some shares
    await fastForwardVesting({ grantId, tenantId, sharesToVest: 1000 });
    // Terminate with buyback
    const res = await request(app)
      .post(`/employees/${employeeId}/terminate`)
      .set('Cookie', adminCookie)
      .send({
        termination_effective_date: '2024-01-01',
        treatment_for_vested: 'buyback',
        reason: 'Test buyback'
      });
    expect(res.statusCode).toBe(200);
    // Fetch pool info
    const pool = await getPoolInfo(tenantId);
    // Fetch grant info
    const grant = await getGrantInfo(grantId, tenantId);
    // Check returned and available
    const expectedReturned = parseFloat(grant.unvestedSharesReturned) + parseFloat(grant.vestedSharesReturned);
    expect(pool.returned).toBeCloseTo(expectedReturned, 3);
    expect(pool.available).toBeCloseTo(pool.totalPool + expectedReturned - pool.granted, 3);
  });

  it('should set vested_shares_returned to actual vested shares as of termination date for buyback, and kept by employee should be zero', async () => {
    // Setup: create employee, grant, and vest some shares
    const { employeeId, grantId } = await createTestEmployeeAndGrant({ tenantId });
    // Fast-forward vesting to vest 100 shares on two dates
    await fastForwardVesting({ grantId, tenantId, sharesToVest: 60, vestDate: '2024-01-01' });
    await fastForwardVesting({ grantId, tenantId, sharesToVest: 40, vestDate: '2024-02-01' });
    // Terminate with buyback on 2024-02-01
    const res = await request(app)
      .post(`/employees/${employeeId}/terminate`)
      .set('Cookie', adminCookie)
      .send({
        termination_effective_date: '2024-02-01',
        treatment_for_vested: 'buyback',
        reason: 'Test buyback'
      });
    expect(res.statusCode).toBe(200);
    // Check grant record
    const grant = db.get('SELECT vested_shares_returned FROM grant_record WHERE grant_id = ?', [grantId]);
    // Should match sum of vesting_event up to and including 2024-02-01
    const vestedRow = db.get('SELECT SUM(shares_vested) as vested FROM vesting_event WHERE grant_id = ? AND vest_date <= ?', [grantId, '2024-02-01']);
    expect(parseFloat(grant.vested_shares_returned)).toBeCloseTo(parseFloat(vestedRow.vested), 3);
    // Check kept by employee is zero
    const poolModel = require('../../src/models/pool');
    const kept = poolModel.getKeptByEmployeeShares(tenantId);
    expect(kept).toBeCloseTo(0, 3);
  });
}); 