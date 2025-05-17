/**
 * Tests for CSRF protection middleware
 */

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const BetterSqlite3Store = require('better-sqlite3-session-store')(session);
const Database = require('better-sqlite3');
const csrf = require('../../src/middlewares/csrf');
const path = require('path');
const fs = require('fs');

describe('CSRF Protection Tests', () => {
  let app;
  let sessionDb;
  let server;
  let agent;
  
  beforeAll(() => {
    // Setup test session database
    const sessionDbPath = path.join(__dirname, '../../data/test_sessions.db');
    
    // Create data directory if needed
    const dataDir = path.dirname(sessionDbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Remove existing session database
    if (fs.existsSync(sessionDbPath)) {
      fs.unlinkSync(sessionDbPath);
    }
    
    // Create session database
    sessionDb = new Database(sessionDbPath);
    
    // Create express app
    app = express();
    
    // Configure middleware
    app.use(cookieParser());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    
    // Configure session
    app.use(session({
      store: new BetterSqlite3Store({
        client: sessionDb,
        expired: {
          clear: true,
          intervalMs: 900000 // 15 minutes
        }
      }),
      secret: 'test-session-secret',
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false }
    }));
    
    // Add CSRF protection
    app.use(csrf.csrfProtection);
    
    // Add routes for testing
    app.get('/csrf-token', (req, res) => {
      res.json({ csrfToken: req.csrfToken() });
    });
    
    app.get('/protected', (req, res) => {
      res.json({ message: 'Protected route accessed successfully' });
    });
    
    app.post('/submit', (req, res) => {
      res.json({ message: 'Form submitted successfully', data: req.body });
    });
    
    // Start server
    server = app.listen(0); // random port
    
    // Create supertest agent to maintain cookies between requests
    agent = request.agent(app);
  });
  
  afterAll(() => {
    // Close server and database
    server.close();
    sessionDb.close();
    
    // Delete test session database
    const sessionDbPath = path.join(__dirname, '../../data/test_sessions.db');
    if (fs.existsSync(sessionDbPath)) {
      fs.unlinkSync(sessionDbPath);
    }
  });
  
  test('should generate a CSRF token', async () => {
    const response = await agent.get('/csrf-token');
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('csrfToken');
    expect(typeof response.body.csrfToken).toBe('string');
    expect(response.body.csrfToken.length).toBeGreaterThan(0);
  });
  
  test('should allow GET request to protected route without token', async () => {
    const response = await agent.get('/protected');
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('message');
    expect(response.body.message).toBe('Protected route accessed successfully');
  });
  
  test('should reject POST request without CSRF token', async () => {
    const response = await agent
      .post('/submit')
      .send({ name: 'Test User' });
    
    expect(response.status).toBe(403);
  });
  
  test('should reject POST request with invalid CSRF token', async () => {
    const response = await agent
      .post('/submit')
      .send({ name: 'Test User', _csrf: 'invalid-token' });
    
    expect(response.status).toBe(403);
  });
  
  test('should accept POST request with valid CSRF token', async () => {
    // First get a CSRF token
    const tokenResponse = await agent.get('/csrf-token');
    const csrfToken = tokenResponse.body.csrfToken;
    
    // Then submit the form with the token
    const formResponse = await agent
      .post('/submit')
      .send({ name: 'Test User', _csrf: csrfToken });
    
    expect(formResponse.status).toBe(200);
    expect(formResponse.body).toHaveProperty('message');
    expect(formResponse.body.message).toBe('Form submitted successfully');
    expect(formResponse.body).toHaveProperty('data');
    expect(formResponse.body.data).toHaveProperty('name', 'Test User');
  });
  
  test('should accept token in request header', async () => {
    // First get a CSRF token
    const tokenResponse = await agent.get('/csrf-token');
    const csrfToken = tokenResponse.body.csrfToken;
    
    // Then submit with token in header
    const formResponse = await agent
      .post('/submit')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Header Test' });
    
    expect(formResponse.status).toBe(200);
    expect(formResponse.body).toHaveProperty('message');
    expect(formResponse.body.message).toBe('Form submitted successfully');
  });
  
  test('should maintain CSRF token across requests in same session', async () => {
    // Get initial token
    const tokenResponse1 = await agent.get('/csrf-token');
    const csrfToken1 = tokenResponse1.body.csrfToken;
    
    // Get token again in same session
    const tokenResponse2 = await agent.get('/csrf-token');
    const csrfToken2 = tokenResponse2.body.csrfToken;
    
    // The tokens should be different per request for added security
    expect(csrfToken1).not.toBe(csrfToken2);
    
    // Both tokens should work since they're in the same session
    const formResponse1 = await agent
      .post('/submit')
      .send({ name: 'Token1 Test', _csrf: csrfToken1 });
    
    expect(formResponse1.status).toBe(200);
    
    const formResponse2 = await agent
      .post('/submit')
      .send({ name: 'Token2 Test', _csrf: csrfToken2 });
    
    expect(formResponse2.status).toBe(200);
  });
}); 