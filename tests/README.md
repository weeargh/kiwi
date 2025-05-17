# RSU Platform Testing Framework

This directory contains the test suite for the RSU/ESOP Platform. The tests cover both unit testing of individual components and integration testing of the system as a whole.

## Test Structure

The test files are organized into categories:

- **`/tests/utils`**: Tests for utility functions
- **`/tests/models`**: Tests for data models
- **`/tests/db`**: Tests for database operations
- **`/tests/csrf`**: Tests for CSRF protection

## Test Coverage

### Utility Functions

- **`decimal.test.js`**: Basic decimal utility functions
- **`decimal-edge-cases.test.js`**: Edge cases for decimal precision and calculations
- **`date.test.js`**: Basic date utility functions
- **`vesting-schedule.test.js`**: Vesting schedule calculations and edge cases

### Database Operations

- **`transaction-errors.test.js`**: Error handling in database transactions

### Models

- **`employee.test.js`**: Employee model operations
- **`grant.test.js`**: Grant model operations

### Security

- **`protection.test.js`**: CSRF protection middleware

## Running Tests

To run all tests:

```bash
npm test
```

To run a specific test file:

```bash
npm test -- tests/utils/decimal-edge-cases.test.js
```

## Test Environment

Tests use a separate database file (`test_rsu_platform.db`) to avoid affecting production data. Two testing modes are available:

1. **Read-Only Mode**: Tests run with `TEST_READ_ONLY=true` can only read from the database, not modify it
2. **Transaction Mode**: Tests run with `TEST_READ_ONLY=false` can modify the database, but changes should be rolled back

## New Test Coverage

### Vesting Schedule Edge Cases

These tests validate that vesting calculations handle various edge cases correctly:

- Leap year handling (February 29)
- Month-end transitions (January 31 → February 28/29)
- 48-month standard vesting schedule
- Partial month calculations

### Decimal Precision Edge Cases

These tests ensure financial calculations maintain proper precision:

- Large number handling (1 million+ shares)
- Banker's rounding behavior (half to even)
- Boundary cases at rounding thresholds
- Vesting calculations with uneven divisions

### Transaction Error Handling

These tests verify that database transactions properly maintain data consistency:

- Transaction rollback on error
- Nested operation handling
- Unique constraint violation handling
- Async function rejection in transactions 