const { formatForTenantDisplay } = require('../../src/utils/formatForTenantDisplay');

describe('formatForTenantDisplay', () => {
  test('should format to 0 dp', () => {
    expect(formatForTenantDisplay('1.234', 0)).toBe('1');
    expect(formatForTenantDisplay('1.5', 0)).toBe('2');
    expect(formatForTenantDisplay('1.499', 0)).toBe('1');
  });

  test('should format to 1 dp', () => {
    expect(formatForTenantDisplay('1.234', 1)).toBe('1.2');
    expect(formatForTenantDisplay('1.25', 1)).toBe('1.3');
    expect(formatForTenantDisplay('1.20', 1)).toBe('1.2');
    expect(formatForTenantDisplay('1', 1)).toBe('1.0');
  });

  test('should format to 2 dp', () => {
    expect(formatForTenantDisplay('1.234', 2)).toBe('1.23');
    expect(formatForTenantDisplay('1.235', 2)).toBe('1.24');
    expect(formatForTenantDisplay('1.2', 2)).toBe('1.20');
    expect(formatForTenantDisplay('1', 2)).toBe('1.00');
  });

  test('should format to 3 dp', () => {
    expect(formatForTenantDisplay('1.234', 3)).toBe('1.234');
    expect(formatForTenantDisplay('1.235', 3)).toBe('1.235');
    expect(formatForTenantDisplay('1.2', 3)).toBe('1.200');
    expect(formatForTenantDisplay('1', 3)).toBe('1.000');
  });

  test('should fallback to 3 dp if out of range', () => {
    expect(formatForTenantDisplay('1.234', 4)).toBe('1.234');
    expect(formatForTenantDisplay('1.234', -1)).toBe('1.234');
  });
}); 