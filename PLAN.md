# RSU/ESOP Platform Implementation Plan (Simplified)

## Overview
This plan outlines a simplified approach to building the RSU/ESOP platform described in SPECIFICATION.md. We're adopting a minimalist tech stack to reduce complexity while still delivering the core functionality.

## Tech Stack
- **Backend**: Node.js with Express
- **Database**: SQLite (single file)
- **Authentication**: Simple email/password with session cookies
- **Frontend**: Server-rendered EJS templates with Bootstrap CSS
- **Deployment**: Single VPS with PM2 for process management

## Core Requirements from Specification

These key requirements from SPECIFICATION.md will be preserved despite simplification:

1. **Decimal Precision**: While simplifying from DECIMAL(12,3) to REAL, we will add application-level validation to ensure 3 decimal place precision in all calculations and display
2. **Vesting Algorithm**: The exact vesting algorithm including cliff, month-end rules, and leap-year handling will be implemented as specified
3. **Pool Integrity**: The constraint that available shares must be ≥ 0 will be enforced by application logic
4. **Timezone Awareness**: All date calculations will respect the tenant's timezone setting
5. **Audit Trail**: While simplified, we'll maintain core audit logging capability
6. **Tenant Isolation**: Multi-tenant support will be preserved with proper data isolation

## Implementation Phases

### Phase 1: Foundation (COMPLETED)
**Goal**: Set up project structure, database schema, and authentication.

**Tasks**:
- [x] Initialize Express project with EJS template engine
- [x] Set up SQLite database connection
- [x] Implement the database schema (simplified from SPECIFICATION.md)
- [x] Create basic user authentication (register, login, logout)
- [x] Implement session management
- [x] Set up role-based access control (admin vs employee)
- [x] Create basic layout templates with Bootstrap
- [x] Implement tenant data model and basic settings
- [x] Create application-level decimal handling utility (to ensure 3dp precision)

**Status**: COMPLETED
- Repository initialized with proper structure
- SQLite database connection working
- Express server running with basic routes
- EJS templates implemented
- Authentication system with roles complete
- Admin and employee dashboards functional
- Decimal precision utility implemented

### Phase 2: Pool & PPS Management (COMPLETED)
**Goal**: Implement equity pool management and price-per-share functionality.

**Tasks**:
- [x] Create equity pool data model and CRUD operations
- [x] Implement pool event tracking (initial, top-up, reduction)
- [x] Build pool metrics calculations (total, granted, returned, available)
- [x] Create transaction wrapper to ensure pool integrity (instead of stored procedure)
- [x] Implement PPS history and current PPS lookup
- [x] Implement the exact PPS lookup logic from spec (using effective_date + created_at DESC)
- [x] Create admin UI for managing pools and PPS
- [x] Add form validation for decimal inputs
- [x] Implement constraint that available shares must be ≥ 0
- [x] Create simple audit log for pool and PPS changes

**Status**: COMPLETED
- Equity pool model implemented with all required functionality
- Pool events (top-up, reduction) functioning correctly
- PPS history and current PPS lookup implemented
- Admin UI for pool and PPS management complete
- Form validation for decimal inputs implemented
- Audit logging for all operations functioning
- Pool metrics calculations working properly
- Pool integrity constraint enforced

### Phase 3: Employee & Grant Management (COMPLETED)
**Goal**: Implement employee management and RSU grant creation.

**Tasks**:
- [x] Build employee data model with CRUD operations
- [x] Implement grant data model with version field for optimistic locking
- [x] Create grant validation (ensure available shares ≥ requested amount)
- [x] Implement transaction-based pool updates when creating grants
- [x] Build admin UI for employee management
- [x] Create admin UI for grant creation and management
- [x] Implement employee-facing view of grants
- [x] Add grant status tracking (active/inactive)

**Status**: COMPLETED
- Employee model fully implemented with CRUD operations
- Grant model implemented with optimistic locking and versioning
- Grant validation with available shares check implemented
- Transaction handling ensures data integrity during grant operations
- Admin UI for employee management completed
- Grant creation, termination, and vesting UI implemented
- Employee view of grants completed with filtering

**Milestone 3A: Employee Management**
- [x] Employee model implemented
- [x] Employee CRUD operations built
- [x] Admin UI for employee management created

**Milestone 3B: Grant Management**
- [x] Grant model implemented with optimistic locking
- [x] Grant validation with pool integrity built
- [x] Admin UI for grant creation developed
- [x] Employee grant view implemented

### Phase 4: Vesting Engine & Termination (COMPLETED)
**Goal**: Implement the vesting calculation engine and termination workflow.

**Tasks**:
- [x] Build the vesting algorithm exactly as specified in Section 4.1
- [x] Implement banker's rounding for tranche calculations
- [x] Apply month-end and leap-year rules correctly
- [x] Create final tranche adjustment to ensure totals match
- [x] Implement vesting event creation for past dates
- [x] Create PPS snapshot functionality
- [x] Implement daily batch process using node-cron (instead of separate worker)
- [x] Create grant termination workflow
- [x] Implement unvested share return calculation
- [x] Add admin UI for termination actions
- [x] Create vesting schedule visualization for employees
- [x] Implement on-demand vesting calculation
- [x] Create flexible vesting processing for grants from any year (including 2010)
- [x] Implement backdated vesting calculation mechanism
- [x] Add support for bypassing cliff for older grants
- [x] Add unique constraint to prevent duplicate vesting events
- [x] Enhance transaction handling for better concurrency control
- [x] Improve error handling and logging throughout the vesting system
- [x] Organize and consolidate vesting-related files and documentation
- [x] Create comprehensive test suite for vesting functionality

**Status**: COMPLETED
- Vesting engine fully implemented with all specified rules
- Flexible vesting processing for grants from any year/date implemented
- Termination workflow completed with unvested share returns
- Batch vesting and on-demand vesting functioning
- PPS snapshots recorded properly for all vesting events
- Special handling for backdated grants implemented
- Smart cliff handling for older grants added
- Duplicate vesting prevention implemented with database constraints
- Enhanced transaction handling for better concurrency control
- Improved error handling and logging throughout the system
- Vesting-related files organized with obsolete scripts archived
- Comprehensive test suite created for vesting functionality
- Consolidated documentation created in VESTING.md
- All UI components for vesting management completed

### Phase 5: Testing & Deployment (PENDING)
**Goal**: Test the application thoroughly and deploy to production.

**Tasks**:
- [ ] Write integration tests for critical paths
- [ ] Test edge cases from Section 4.3 of the specification
- [ ] Set up VPS on DigitalOcean/Linode
- [ ] Configure Node.js environment and PM2
- [ ] Implement daily SQLite backup
- [ ] Create deployment script
- [ ] Set up basic monitoring
- [ ] Document the application
- [ ] Perform UAT with test users

**Status**: PENDING
- To be implemented after Phase 4

### Phase 6: UID Migration & Security Hardening (2024-06)
**Goal**: Migrate all entities from sequential integer IDs to secure, random UIDs for improved security and multi-tenant isolation.

**Motivation:**
- Prevent ID-guessing attacks and enumeration.
- Ensure all entity references are secure and unguessable.
- Align with best practices for multi-tenant SaaS platforms.

**Tasks:**
- [x] Update all database tables to use `*_uid` as primary and foreign keys.
- [x] Update all backend models, services, and routes to use UIDs exclusively.
- [x] Update all frontend templates and JS to use UIDs in links, forms, and data attributes.
- [x] Update all API endpoints, request/response bodies, and documentation to use UIDs.
- [x] Update all test cases and test data to use UIDs.
- [x] Update all documentation (README, SPECIFICATION.md, PLAN.md, api.yml, schema) to reflect UID usage.

**Status:** COMPLETED
- All code, endpoints, and documentation now use UIDs exclusively for all entities.
- Security and tenant isolation are significantly improved.

## Changelog
- **2024-06:** Full migration to secure, random UIDs for all entities. All code, API, and documentation updated for UID-only usage.

## Current Progress

1. **Phase 1 (Foundation)**: COMPLETED
   - Authentication system with roles is fully functional
   - Database structure implemented
   - Core utilities for decimal handling, date formatting, and validation in place
   - EJS templating with layouts implemented

2. **Phase 2 (Pool & PPS Management)**: COMPLETED
   - Pool management with metrics (total, granted, returned, available) implemented
   - Pool event tracking (top-ups and reductions) functioning
   - PPS history and current PPS lookup implemented
   - Admin UI for both modules complete with proper validation

3. **Phase 3 (Employee & Grant Management)**: COMPLETED
   - Employee model with all CRUD operations implemented
   - Grant management with optimistic locking functionality
   - Grant creation with pool availability check working
   - Grant termination with unvested share return functionality
   - Admin and employee UIs for grants completed
   - Data validation and error handling in place

4. **Phase 4 (Vesting Engine & Termination)**: COMPLETED
   - Grant termination workflow implemented
   - Unvested share return calculations working
   - Manual vesting event creation implemented
   - Admin UI for termination and vesting actions complete
   - Vesting algorithm fully implemented with month-end and leap-year rules
   - Daily batch vesting calculation process developed
   - Backdated vesting calculation for historical grants implemented
   - Vesting schedule visualization for employees completed
   - Smart cliff handling for older grants added
   - Flexible processing for grants from any year (2010 onwards) implemented

5. **Phase 6 (UID Migration & Security Hardening)**: COMPLETED
   - All entities migrated to secure, random UIDs
   - Security and tenant isolation improved
   - All code, API, and documentation updated for UID usage

6. **Next Steps**:
   - Begin testing phase with focus on edge cases from Section 4.3
   - Prepare for deployment
   - Set up monitoring and backup systems
   - Conduct user acceptance testing
   - Document the application

## Simplified Design Decisions

### Database Simplifications
1. Use SQLite's built-in transactions instead of PostgreSQL SERIALIZABLE isolation
2. Implement transaction-based integrity checks in application code
3. Simplify indexes for SQLite compatibility 
4. Remove complex constraints and handle in application code
5. Store audit logs in a separate table but with simpler structure

### Authentication Simplifications
1. Use email/password with bcrypt instead of JWT/Auth0
2. Store session data in SQLite or memory store
3. Use middleware to check roles (admin/employee)

### UI Simplifications
1. Server-rendered pages instead of SPA
2. Bootstrap for responsive layouts without custom CSS
3. Minimal client-side JavaScript

### Operational Simplifications
1. Single server deployment
2. Simple file-based backups
3. Use PM2 for reliability instead of containers
4. Log to files instead of complex logging systems
5. Use node-cron for scheduled tasks instead of separate worker process

## System Maintenance and Bug Fixes

### May 11, 2025: Database and Transaction Handling Fixes

**Issue 1: SQL Error in Vesting Middleware**
The automatic vesting middleware was failing with an error: `SQLITE_ERROR: no such column: g.id`. This was happening because the middleware was trying to query a column named `g.id` but the database schema uses `grant_id` as the column name for grant identification.

**Resolution:**
- Updated the vesting middleware to use the correct column name `g.grant_uid` in SQL queries
- Fixed all references to grant ID properties in the middleware's logging and processing code

**Issue 2: Grant Creation Error**
Users were encountering a "Grant creation failed or returned invalid object" error when attempting to create new grants. This was caused by two issues:
1. Inconsistent property naming in the grant model vs. database schema (`uid` vs. `grant_uid`)
2. A fundamental flaw in the database transaction handling that wasn't properly returning the created grant object

**Resolution:**
- Updated the grant model to include both `uid` and `grant_uid` properties for compatibility
- Modified the grant routes to check for either property when validating the grant object
- Fixed the database transaction function to properly return the result of callback functions
- Enhanced error logging for better diagnostics

These fixes maintain the integrity of the database schema while ensuring proper communication between layers of the application.

## Database Schema Adaptations

While maintaining the core structure from SPECIFICATION.md, these SQLite-specific simplifications will be made:

- Replace UUIDs with INTEGER PRIMARY KEY AUTOINCREMENT
- Simplify DECIMAL(12,3) to REAL with application-level validation
- Handle soft deletes via application code
- Remove complex constraints and foreign keys (handled in app code)
- Simplify indexes for better SQLite performance

### Critical Schema Components to Preserve

1. **Grant Table**: version field for optimistic locking
2. **VestingEvent Table**: pps_snapshot field to record PPS at vest time
3. **PPSHistory**: effective_date + created_at for proper lookup

## API Implementation

We'll implement a simplified version of the API defined in api.yml, focusing on core endpoints:

1. **Authentication**: 
   - POST /auth/login
   - POST /auth/logout
   
2. **Tenant Management**:
   - GET/PATCH /tenant

3. **User Management**:
   - CRUD operations for /users
   
4. **Pool Management**:
   - GET /pools (with calculated metrics)
   - GET/POST /pools/{id}/events

5. **PPS Management**:
   - GET /pps/current
   - GET/POST /pps

6. **Employee Management**:
   - CRUD operations for /employees

7. **Grant Management**:
   - CRUD operations for /grants
   - POST /grants/{id}/terminate
   - POST /grants/{id}/calculate-vesting
   - GET /grants/{id}/vesting-events

8. **Vesting**:
   - Scheduled task replacing /vesting/batch-calculate

9. **Utilities**:
   - GET /constants/currencies
   - GET /health
   - GET /audit-logs

## Success Criteria
- Application fully implements core requirements from SPECIFICATION.md
- Vesting calculations match the specified algorithm exactly
- Transaction handling ensures data integrity despite simplified DB
- System performs adequately for initial customers
- User experience is responsive and intuitive
- Backend is maintainable with minimal operational overhead

## Project Management

### Weekly Deliverables
Each week will end with a deliverable that can be demonstrated and validated:
- **Week 1**: Authentication system and project structure
- **Week 2**: Core tenant management and decimal handling
- **Week 3**: Equity pool management and metrics
- **Week 4**: PPS management and full admin UI for pool/PPS
- **Week 5**: Employee management system
- **Week 6**: Grant management system
- **Week 7**: Vesting engine and visualization
- **Week 8**: Termination workflow and scheduled jobs
- **Week 9**: Deployed production application

### Progress Tracking
- Daily code commits with clear messages
- Weekly progress review meeting
- Automated test reports 
- Issue tracking for any discovered bugs
- Weekly demo of completed features

### Risk Mitigation
1. **Technical Risks**:
   - **Database performance**: If SQLite shows performance issues, optimize indexes and query patterns before considering migration
   - **Precision issues**: Extensive testing of decimal operations to ensure no rounding errors
   - **Session management**: Have fallback to file-based sessions if in-memory becomes problematic

2. **Schedule Risks**:
   - Start with core functionality first
   - Maintain flexible prioritization of features
   - Have clear criteria for MVP vs. post-launch enhancements

3. **Operational Risks**:
   - Implement comprehensive error logging from day one
   - Create automated backup strategy early
   - Test restore procedures regularly

## Future Growth Considerations
- Eventual migration path to PostgreSQL for >50 customers
- Potential to add Redis for session storage at scale
- Migration to separate frontend/backend when needed
- Path to container-based deployment for reliability at scale
- Export/import functionality for bulk operations

## Launch Checklist

Before considering the project complete, verify:

1. **Functionality**:
   - All requirements from SPECIFICATION.md implemented
   - All edge cases handled correctly
   - Complete test coverage

2. **Security**:
   - Authentication working correctly
   - CSRF protection in place
   - Input validation on all endpoints
   - Session management secure

3. **Operations**:
   - Backups configured and tested
   - Monitoring in place
   - Logs properly captured
   - Deployment process documented

4. **Documentation**:
   - User documentation complete
   - Admin documentation complete
   - API documentation complete
   - Operational procedures documented

## Employee Termination Workflow Implementation

### Backend
- [ ] Implement `POST /employees/{employee_uid}/terminate` endpoint
- [ ] Update logic to terminate all active grants for the employee with the same termination_effective_date and treatment
- [ ] Update employee status to `inactive` if all grants are terminated
- [ ] Ensure vesting engine skips grants with a termination_effective_date in the past
- [ ] Audit log all actions

### UI/UX
- [ ] Add "Terminate Employee" action in admin UI
- [ ] Confirmation modal with effective date picker and treatment options
- [ ] Display warnings for already-terminated grants or if per-grant overrides are needed

### Testing
- [ ] Integration tests for employee-level termination (including edge cases: already-terminated grants, future-dated terminations, etc.)
- [ ] Ensure audit logs are created for all actions

### Documentation
- [ ] Update user/admin guides to reflect new workflow

### Ongoing
- [ ] Update SPECIFICATION.md and PLAN.md for every step

# Kiwi4 Production Readiness Plan

## Completed
- Session separation: Only one of admin or employee session can be active at a time.
- Strict access control: Middleware enforces role-based access to all routes.
- CSRF protection enabled for all routes.
- Passwords hashed with bcrypt; employee login uses email passcode.
- Rate limiting and account lockout on login endpoints.
- Security headers set with Helmet.
- Error handling: Friendly error pages, no stack traces in production.
- Sensitive session logging disabled in production.

## To Do for Production Launch
- Set strong, unique secrets in `.env` (SESSION_SECRET, SMTP, etc.).
- Enforce HTTPS (redirect HTTP to HTTPS, set `secure: true` for cookies).
- Use a process manager (e.g., pm2) for app uptime.
- Set `NODE_ENV=production` in the environment.
- Regularly audit and update dependencies (`npm audit`).
- Consider using a production-grade database (PostgreSQL/MySQL) for scaling.
- Set up monitoring and alerting (e.g., Sentry, uptime checks).
- Serve static assets efficiently (consider CDN for large files).
- Document all environment variables and deployment steps in README.

## Optional Enhancements
- Add a logging library for structured logs (winston, pino).
- Tighten Content Security Policy (CSP) settings.
- Review all user input/output for escaping and sanitization.

---

**Status:**
- The app is secure and robust for production use, pending the above final steps.
