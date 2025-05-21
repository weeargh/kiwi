# Kiwi4 RSU/ESOP Platform

A comprehensive platform for managing equity plans, including RSUs, ESOPs, and vesting schedules, with support for terminations, buybacks, and detailed reporting.

## Quick Start

### Prerequisites
- Node.js 18 or higher
- npm 8 or higher
- SQLite 3

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/kiwi4.git
cd kiwi4
```

2. Install dependencies:
```bash
npm install
```

3. Initialize the database:
```bash
npm run setup-db
```

4. Start the development server:
```bash
npm run dev
```

The application should now be running at http://localhost:3000.

## Documentation

This project maintains detailed documentation on schema, naming conventions, and coding standards:

### Key Documentation Files

- **`convention.md`**: Defines naming conventions for variables, database fields, and frontend-backend mappings.
- **`docs/SCHEMA-DOCUMENTATION.md`**: Comprehensive reference for the database schema, including all tables, constraints, and acceptable values.
- **`docs/SCHEMA-VALIDATION.md`**: Compares documented conventions against actual implementation, highlighting any discrepancies.
- **`docs/MAINTENANCE.md`**: System maintenance procedures and archiving documentation.

### Coding Standards

- Database and API: Use `snake_case` for all field names
- Frontend JavaScript: Use `camelCase` for all variable names and form fields
- Mappings: Use the utility functions in `src/utils/formMapping.js` to convert between naming conventions

### Important Concepts

- **Employee vs. Grant Termination**: An employee termination affects all grants for that employee, setting their status to `inactive`. Each grant's `treatment_for_vested` determines how vested shares are handled.
- **Treatment Types**: The three standard treatments are `buyback`, `retain`, and `cancel`. Each corresponds to a specific event type in the ledger.
- **Event Types**: Pool events use specific types like `return_boughtback`, `kept_by_employee`, and `return_forfeited` to track share movements.

For more details, refer to the documentation files mentioned above.

## Features

- **Multi-tenant Support**: Manage multiple organizations with isolated data
- **Equity Pool Management**: Create and manage equity pools with full accounting
- **Employee Management**: Track employee information and grant assignments
- **Vesting Schedule Management**: Support for complex vesting schedules with cliff periods
- **Termination Handling**: Process employee and grant terminations with various treatment options
- **Reporting**: Generate comprehensive reports for auditing and analysis
- **Automatic Archiving**: Schedule-based archiving of logs and reports

## Deployment

### Production Deployment

To deploy in a production environment:

1. Set environment variables:
```bash
# Security settings
NODE_ENV=production
SESSION_SECRET=your-secure-session-secret

# Application settings
PORT=3001
```

2. Start the server:
```bash
npm start
```

### Using PM2 (Recommended)

For production environments, we recommend using PM2:

```bash
npm install -g pm2
pm2 start npm --name "kiwi4" -- start
pm2 save
```

## Maintenance

Run the automated maintenance scripts to keep your installation healthy:

```bash
# Set up automated log rotation and report cleanup
node scripts/setup-cron.js

# Manual archiving
node scripts/archive-logs.js
```

See `docs/MAINTENANCE.md` for more information.

## Project Organization

### Directory Structure
- **`src/`**: Main application code
  - **`utils/`**: Utility functions and helpers
  - **`db/`**: Database schema and connection
  - **`routes/`**: API endpoints
  - **`models/`**: Data models
  - **`middlewares/`**: Express middlewares
  - **`views/`**: Frontend templates
- **`scripts/`**: Utility scripts
  - **`db/`**: Database maintenance scripts
  - **`test/`**: Test scripts
- **`docs/`**: Documentation files
- **`archive/`**: Archived files and logs
- **`data/`**: Application data
  - **`reports/`**: Generated reports
  - **`backup/`**: Database backups

## Database Setup

To initialize a fresh database with the correct schema:

```bash
sqlite3 data/rsu_platform.db < src/db/schema.sql
```

Or use the setup script:

```bash
node setup-db.js
```

## Development

### Running Tests

```bash
npm test
```

### Linting

```bash
npm run lint
```

### Coding Standards

- **Database and API**: Use `snake_case` for all field names
- **Frontend JavaScript**: Use `camelCase` for all variable names and form fields
- **Consistency**: Use the utility functions in the following files for working with the data:
  - `src/utils/eventTypes.js`
  - `src/utils/fieldNames.js`
  - `src/utils/formMapping.js`

## License

This project is proprietary software.
