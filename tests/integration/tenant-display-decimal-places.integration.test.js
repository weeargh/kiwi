const request = require('supertest');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { formatForTenantDisplay } = require('../../src/utils/formatForTenantDisplay');
const { setDisplayDecimalPlaces, getDisplayDecimalPlaces } = require('../../src/models/tenant');

// Set up test DB path and environment
const TEST_DB_PATH = path.join(__dirname, '../../data/test_tenant_display_decimal_places.db');
process.env.NODE_ENV = 'test';
process.env.TEST_DB_PATH = TEST_DB_PATH;
process.env.DB_PATH = TEST_DB_PATH;

// Helper to initialize test DB and insert a test tenant
function setupTestDb() {
  // Remove old test DB
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const db = new Database(TEST_DB_PATH);
  db.prepare(`CREATE TABLE IF NOT EXISTS tenant (
    tenant_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    display_decimal_places INTEGER DEFAULT 0
  );`).run();
  db.prepare("INSERT INTO tenant (tenant_id, name, display_decimal_places) VALUES (1, 'Test Tenant', 0);").run();
  db.close();
}

// Clean up test DB
function cleanupTestDb() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
}

describe('Tenant Display Decimal Places Integration', () => {
  let app;
  let getDisplayDecimalPlaces, setDisplayDecimalPlaces;

  beforeAll(() => {
    setupTestDb();
    // Clear require cache for both db and tenant model
    delete require.cache[require.resolve('../../src/db')];
    delete require.cache[require.resolve('../../src/models/tenant')];
    ({ getDisplayDecimalPlaces, setDisplayDecimalPlaces } = require('../../src/models/tenant'));
    app = express();
    app.use(bodyParser.json());
    app.use(session({ secret: 'test', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { req.session.user = { tenant_id: 1 }; next(); });
    app.use('/settings', require('../../src/routes/settings'));
  });

  afterAll(() => {
    cleanupTestDb();
  });

  test('should set and get display decimal places, and format value for display', async () => {
    // Set to 2 dp
    await request(app)
      .post('/settings/display-decimal-places')
      .send({ display_decimal_places: 2 })
      .expect(200)
      .expect(res => {
        expect(res.body.success).toBe(true);
        expect(res.body.display_decimal_places).toBe(2);
      });

    // Get the setting
    await request(app)
      .get('/settings/display-decimal-places')
      .expect(200)
      .expect(res => {
        expect(res.body.display_decimal_places).toBe(2);
      });

    // Simulate backend value and frontend formatting
    const backendValue = "1.500";
    const tenantDp = getDisplayDecimalPlaces(1);
    const display = formatForTenantDisplay(backendValue, tenantDp);
    expect(display).toBe("1.50");
  });

  test('should default to 0 dp if not set', async () => {
    // Set to 0 dp
    await request(app)
      .post('/settings/display-decimal-places')
      .send({ display_decimal_places: 0 })
      .expect(200);

    // Simulate backend value and frontend formatting
    const backendValue = "1.500";
    const tenantDp = getDisplayDecimalPlaces(1);
    const display = formatForTenantDisplay(backendValue, tenantDp);
    expect(display).toBe("1");
  });
}); 