# RSU/ESOP Platform (Kiwi4)

A lean, maintainable equity management platform for startups built with a simplified tech stack.

> "Equity management that feels like compensation — not compliance."

## Core Documents

This project is defined by three key documents that work together:

1. **SPECIFICATION.md**: The functional requirements and business rules
2. **PLAN.md**: The implementation roadmap using our simplified tech stack
3. **api.yml**: The API contract (OpenAPI 3.0)

## Tech Stack (Simplified)

- **Backend**: Node.js with Express
- **Database**: SQLite (single file with better-sqlite3)
- **Authentication**: Simple email/password with session cookies
- **Security**: CSRF protection for all forms
- **Frontend**: Server-rendered EJS templates with Bootstrap CSS
- **Deployment**: Single VPS with PM2

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Basic command line knowledge

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/kiwi4.git
cd kiwi4

# Install dependencies
npm install

# Initialize the database and run migrations
npm run db:setup

# Start the development server
npm run dev
```

## Project Structure

```
kiwi4/
├── src/              # Application source code
│   ├── db/           # Database setup and migrations
│   ├── models/       # Data models
│   ├── routes/       # Express routes
│   ├── services/     # Business logic
│   ├── utils/        # Utility functions
│   └── views/        # EJS templates
├── public/           # Static assets
├── tests/            # Test suite
├── scripts/          # Utility, fix, and maintenance scripts (all scripts now live here)
├── archive/          # Deprecated or legacy scripts and documentation (e.g., migration notes)
├── VESTING.md        # Vesting system documentation (consolidated)
├── SPECIFICATION.md  # Functional requirements
├── PLAN.md           # Implementation roadmap
├── api.yml           # API specification
└── README.md         # This file
```

## Key Features

- Multi-tenant equity management
- Precise vesting calculation with cliff and monthly schedules
- Pool management with top-ups and reductions
- Price-per-share (PPS) history tracking
- Grant management and termination handling
- Employee and admin portals
- Flexible vesting processing for grants from any time period
- Backdated vesting calculation for historical grants
- Smart handling of cliff periods for older grants
- **All pool metrics (Initial Amount, Granted, Returned, Available) are left-aligned for visual consistency.**

## Security Features

### UID Migration (2024-06)

- All entities (tenants, users, employees, grants, pools, PPS, events, etc.) now use secure, random UID fields (e.g., `*_uid`) as their primary and foreign keys.
- Sequential integer IDs have been fully removed from the database schema, backend, frontend, and API.
- All endpoints, templates, and business logic now reference UIDs exclusively.
- **Security benefit:** UIDs prevent ID-guessing attacks and improve multi-tenant isolation.
- See SPECIFICATION.md and api.yml for updated data models and endpoint details.

### CSRF Protection

All forms in the application are protected against Cross-Site Request Forgery (CSRF) attacks:

- CSRF tokens are generated using the `csurf` middleware
- Tokens are included in all forms as hidden fields
- The application header includes a meta tag for JavaScript AJAX requests:
  ```html
  <meta name="csrf-token" content="<%= csrfToken %>">
  ```
- For troubleshooting token issues in development, visit `/csrf-check`
- The system includes robust error handling for CSRF validation failures
- The platform gracefully handles token expiration with clear user guidance

For more details on the CSRF implementation and best practices, see the [SQLITE-MIGRATION.md](SQLITE-MIGRATION.md) document.

## Development Workflow

1. Review SPECIFICATION.md to understand the requirements
2. Follow PLAN.md for implementation phases
3. Use api.yml as the contract for implementing endpoints
4. Run tests to verify implementation matches requirements

## Vesting Processing

The platform supports several methods to process vesting:

### Automatic Vesting

- Happens automatically when a grant with a past date is created
- Daily scheduled batch processing via node-cron (configured in src/app.js)
- Admin UI batch button in the vesting dashboard

### Manual Processing

All utility, fix, and maintenance scripts are now in the `scripts/` directory. See `VESTING.md` for vesting-related scripts and usage. Legacy and migration scripts are in `/archive` for reference only.

**UID-Only:**
All entities (tenants, users, employees, grants, pools, PPS, events, etc.) use secure, random UID fields (e.g., `*_uid`) as their primary and foreign keys. Sequential integer IDs have been fully removed from the database schema, backend, frontend, and API. All endpoints, templates, and business logic now reference UIDs exclusively.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Deployment

```bash
# Build for production
npm run build

# Set up PM2 process
pm2 start ecosystem.config.js

# Set up daily backup
crontab -e
# Add: 0 2 * * * /path/to/backup-script.sh
```

## License

[MIT](LICENSE)

## Decimal Places Handling

- **Backend:**
  - All share-related values are stored and calculated with exactly 3 decimal places (3 dp).
  - API responses always send numbers as strings with 3 dp (e.g., "1.500").

- **Frontend:**
  - Each tenant can configure their preferred display decimal places (0, 1, 2, or 3) in the settings page. Default is 0 dp.
  - All share-related numbers are displayed using the tenant's setting, always padded with zeros (e.g., 1.5 → "1.50" for 2 dp).
  - Calculations and user input are always limited to 3 dp.
  - Utility: `formatForTenantDisplay(value, tenantDp)` is used for consistent formatting.

## Example
| Backend Value | Tenant Display Setting | Frontend Display |
|--------------|-----------------------|------------------|
| "1.500"      | 0                     | 1                |
| "1.500"      | 1                     | 1.5              |
| "1.500"      | 2                     | 1.50             |
| "1.500"      | 3                     | 1.500            |

## Risks & Best Practices
- Backend never stores or calculates with more than 3 dp.
- Frontend only rounds/pads for display, never for calculation.
- User input is validated to max 3 dp.
- Exports and reports use backend (3 dp) values.

## Tests
- See `tests/utils/formatForTenantDisplay.test.js` for test coverage of display formatting.

## Recent Improvements
- Pool metrics UI updated to left-align all values for consistency (Initial Amount, Granted, Returned, Available).
- **2024-06:** Full migration to secure, random UIDs for all entities. All code, API, and documentation updated for UID-only usage.

## Security Note

**File Permissions:**
- Ensure `