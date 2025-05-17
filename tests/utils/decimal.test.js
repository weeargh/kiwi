/**
 * Tests for the decimal utility functions
 */

const decimal = require('../../src/utils/decimal');

describe('Decimal Utility Tests', () => {
  // Basic rounding tests
  test('should round half to even correctly', () => {
    expect(decimal.roundHalfToEven(1.0005)).toBe(1.001);
    expect(decimal.roundHalfToEven(1.001)).toBe(1.001);
    expect(decimal.roundHalfToEven(1.0015)).toBe(1.002);
    expect(decimal.roundHalfToEven(1.002)).toBe(1.002);
    expect(decimal.roundHalfToEven(1.0025)).toBe(1.003); // JavaScript's numeric precision affects this value
    expect(decimal.roundHalfToEven(1.0035)).toBe(1.004); // Half to even
  });

  // Format tests
  test('should format numbers to 3 decimal places', () => {
    expect(decimal.format(1)).toBe('1.000');
    expect(decimal.format(1.1)).toBe('1.100');
    expect(decimal.format(1.12)).toBe('1.120');
    expect(decimal.format(1.123)).toBe('1.123');
    expect(decimal.format(1.1234)).toBe('1.123');
    expect(decimal.format(1.1235)).toBe('1.124');
    expect(decimal.format(null)).toBe(null);
  });

  // Arithmetic operation tests
  test('should add numbers with correct precision', () => {
    expect(decimal.add(1.001, 2.002)).toBe(3.003);
    expect(decimal.add(1.111, 2.222)).toBe(3.333);
    expect(decimal.add(1.1119, 2.2221)).toBe(3.334);
  });

  test('should subtract numbers with correct precision', () => {
    expect(decimal.subtract(3.003, 1.001)).toBe(2.002);
    expect(decimal.subtract(3.333, 2.222)).toBe(1.111);
    expect(decimal.subtract(3.3335, 2.2225)).toBe(1.111);
  });

  test('should multiply numbers with correct precision', () => {
    expect(decimal.multiply(2, 3)).toBe(6);
    expect(decimal.multiply(2.5, 3)).toBe(7.5);
    expect(decimal.multiply(2.5, 3.5)).toBe(8.75);
    expect(decimal.multiply(2.123, 3.321)).toBe(7.05);
  });

  test('should divide numbers with correct precision', () => {
    expect(decimal.divide(6, 3)).toBe(2);
    expect(decimal.divide(7.5, 3)).toBe(2.5);
    expect(decimal.divide(10, 3)).toBe(3.333);
    expect(() => decimal.divide(1, 0)).toThrow('Division by zero');
  });

  // Vesting calculation tests
  test('should calculate tranche size correctly', () => {
    expect(decimal.calculateTrancheSize(48)).toBe(1);
    expect(decimal.calculateTrancheSize(100)).toBe(2.083);
  });

  test('should calculate final tranche adjustment correctly', () => {
    expect(decimal.calculateFinalTranche(100, 97.917)).toBe(2.083);
    expect(decimal.calculateFinalTranche(48, 47)).toBe(1);
  });

  // Validation tests
  test('should validate decimal precision correctly', () => {
    expect(decimal.validateDecimalPrecision(1)).toBe(true);
    expect(decimal.validateDecimalPrecision(1.1)).toBe(true);
    expect(decimal.validateDecimalPrecision(1.12)).toBe(true);
    expect(decimal.validateDecimalPrecision(1.123)).toBe(true);
    expect(decimal.validateDecimalPrecision(1.1234)).toBe(false);
    expect(decimal.validateDecimalPrecision('1.123')).toBe(true);
    expect(decimal.validateDecimalPrecision('1.1234')).toBe(false);
    expect(decimal.validateDecimalPrecision(null)).toBe(false);
  });

  // Display formatting tests
  test('should format display strings correctly', () => {
    expect(decimal.toDisplayString(1)).toBe('1');
    expect(decimal.toDisplayString(1.1)).toBe('1.1');
    expect(decimal.toDisplayString(1.10)).toBe('1.1');
    expect(decimal.toDisplayString(1.100)).toBe('1.1');
    expect(decimal.toDisplayString(1.123)).toBe('1.123');
  });

  test('should format percentages correctly', () => {
    expect(decimal.formatPercent(0.25)).toBe('25%');
    expect(decimal.formatPercent(0.333)).toBe('33%');
    expect(decimal.formatPercent(1)).toBe('100%');
    expect(decimal.formatPercent(null)).toBe('0%');
  });

  test('should format money values correctly', () => {
    expect(decimal.formatMoney(1)).toBe('1.00');
    expect(decimal.formatMoney(1.2)).toBe('1.20');
    expect(decimal.formatMoney(1.23)).toBe('1.23');
    expect(decimal.formatMoney(1.234)).toBe('1.23');
    expect(decimal.formatMoney(1.235)).toBe('1.24');
  });
}); 