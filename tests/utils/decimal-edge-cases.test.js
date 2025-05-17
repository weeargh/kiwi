/**
 * Tests for decimal precision edge cases
 */

const decimal = require('../../src/utils/decimal');

describe('Decimal Precision Edge Cases', () => {
  // Large number tests
  describe('Large Number Handling', () => {
    test('should handle very large share counts correctly', () => {
      // Test with 1 million shares
      expect(decimal.format(1000000)).toBe('1000000.000');
      expect(decimal.roundHalfToEven(1000000.0005)).toBe(1000000.001);
      
      // Test arithmetic with large numbers
      expect(decimal.add(1000000, 0.0005)).toBe(1000000.001);
      expect(decimal.subtract(1000000, 0.0005)).toBe(999999.999);
      
      // Test tranche calculation with large numbers
      // 1 million / 48 = 20833.333
      expect(decimal.calculateTrancheSize(1000000)).toBe(20833.333);
      
      // Test final tranche calculation
      // After 47 months of 20833.333, we'd have 979166.651
      // Final tranche should be 1000000 - 979166.651 = 20833.349
      const vestedAfter47 = decimal.multiply(20833.333, 47);
      expect(vestedAfter47).toBe(979166.651);
      expect(decimal.calculateFinalTranche(1000000, vestedAfter47)).toBe(20833.349);
    });

    test('should maintain precision with repeated operations on large numbers', () => {
      // Start with a large number and perform multiple operations
      let value = 1000000;
      
      // Divide by 3 then multiply by 3 - should be close to original
      const divided = decimal.divide(value, 3);
      expect(divided).toBe(333333.333);
      
      const multiplied = decimal.multiply(divided, 3);
      expect(multiplied).toBe(999999.999);
      
      // The difference should be exactly 0.001 due to precision limits
      expect(decimal.subtract(value, multiplied)).toBe(0.001);
    });
  });

  // Rounding behavior tests
  describe('Rounding Behavior', () => {
    test('should handle banker\'s rounding (half to even) correctly', () => {
      // Regular rounding would round all .5 values up
      // Banker's rounding rounds to nearest even number when exactly halfway
      
      // These should round up (to even)
      expect(decimal.roundHalfToEven(1.5)).toBe(2);
      expect(decimal.roundHalfToEven(3.5)).toBe(4);
      expect(decimal.roundHalfToEven(0.0015)).toBe(0.002);
      expect(decimal.roundHalfToEven(0.0035)).toBe(0.004);
      
      // These should round down (to even)
      expect(decimal.roundHalfToEven(2.5)).toBe(2);
      expect(decimal.roundHalfToEven(4.5)).toBe(4);
      expect(decimal.roundHalfToEven(0.0025)).toBe(0.002);
      expect(decimal.roundHalfToEven(0.0045)).toBe(0.004);
    });

    test('should maintain precision in long calculation chains', () => {
      // Create a chain of calculations that should compound rounding errors
      // without proper handling
      
      // Start with a value that will produce repeating decimals
      let value = 10;
      
      // Divide by 3 repeatedly (10/3 = 3.333, then 3.333/3 = 1.111, etc.)
      for (let i = 0; i < 3; i++) {
        value = decimal.divide(value, 3);
      }
      
      // Multiply by 3 the same number of times
      for (let i = 0; i < 3; i++) {
        value = decimal.multiply(value, 3);
      }
      
      // With perfect precision, we should get back exactly 10
      // With limited precision, we'll get close but not exact
      expect(value).toBeCloseTo(10, 2); // Within 0.01
      
      // Check the exact difference
      const difference = Math.abs(10 - value);
      expect(difference).toBeLessThan(0.01);
    });

    test('should handle repeating decimal division correctly', () => {
      // Test division that produces repeating decimals
      // 1/3 = 0.333... (should be 0.333 with 3 decimal places)
      expect(decimal.divide(1, 3)).toBe(0.333);
      
      // 2/3 = 0.666... (should be 0.667 with 3 decimal places due to rounding)
      expect(decimal.divide(2, 3)).toBe(0.667);
      
      // 1/6 = 0.166... (should be 0.167 with 3 decimal places due to rounding)
      expect(decimal.divide(1, 6)).toBe(0.167);
    });
  });

  // Boundary case tests
  describe('Boundary Cases', () => {
    test('should handle values at rounding thresholds', () => {
      // Just below rounding threshold
      expect(decimal.roundHalfToEven(0.0004999)).toBe(0);
      
      // Exactly at rounding threshold
      expect(decimal.roundHalfToEven(0.0005)).toBe(0.001);
      
      // Just above rounding threshold
      expect(decimal.roundHalfToEven(0.0005001)).toBe(0.001);
      
      // Test boundaries at different decimal positions
      expect(decimal.roundHalfToEven(0.4999)).toBe(0.5);
      expect(decimal.roundHalfToEven(0.5)).toBe(0.5); // Half to even - 0.5 rounds to 0.5
      expect(decimal.roundHalfToEven(0.5001)).toBe(0.5);
      
      expect(decimal.roundHalfToEven(1.4999)).toBe(1.5);
      expect(decimal.roundHalfToEven(1.5)).toBe(1.5); // Half to even - 1.5 rounds to 1.5
      expect(decimal.roundHalfToEven(1.5001)).toBe(1.5);
    });

    test('should validate decimal precision correctly at boundaries', () => {
      // Valid - exactly 3 decimal places
      expect(decimal.validateDecimalPrecision(1.123)).toBe(true);
      
      // Valid - fewer than 3 decimal places
      expect(decimal.validateDecimalPrecision(1.1)).toBe(true);
      
      // Valid - integer
      expect(decimal.validateDecimalPrecision(1)).toBe(true);
      
      // Invalid - more than 3 decimal places
      expect(decimal.validateDecimalPrecision(1.1234)).toBe(false);
      
      // Edge case - very small, but valid precision
      expect(decimal.validateDecimalPrecision(0.001)).toBe(true);
      
      // Edge case - very small, invalid precision
      expect(decimal.validateDecimalPrecision(0.0001)).toBe(false);
    });

    test('should handle very small numbers near zero', () => {
      // Numbers very close to zero, but should round to non-zero
      expect(decimal.roundHalfToEven(0.0004)).toBe(0); // Rounds to 0
      expect(decimal.roundHalfToEven(0.0005)).toBe(0.001); // Rounds to 0.001
      expect(decimal.roundHalfToEven(0.0006)).toBe(0.001); // Rounds to 0.001
      
      // Addition/subtraction with very small numbers
      expect(decimal.add(0.0001, 0.0004)).toBe(0.001); // 0.0005 rounds to 0.001
      expect(decimal.subtract(0.0007, 0.0004)).toBe(0); // 0.0003 rounds to 0
    });
  });

  // Tranche and vesting calculation tests
  describe('Vesting Calculation Edge Cases', () => {
    test('should handle vesting calculations with uneven division', () => {
      // Test with values that don't divide evenly by 48
      
      // 1000 shares / 48 months = 20.833 shares per month
      // After 47 months: 47 * 20.833 = 979.151
      // Final tranche: 1000 - 979.151 = 20.849
      const sharesGranted = 1000;
      const trancheSize = decimal.calculateTrancheSize(sharesGranted);
      expect(trancheSize).toBe(20.833);
      
      const vestedAfter47 = decimal.multiply(trancheSize, 47);
      expect(vestedAfter47).toBe(979.151);
      
      const finalTranche = decimal.calculateFinalTranche(sharesGranted, vestedAfter47);
      expect(finalTranche).toBe(20.849);
      
      // Verify total is exactly 1000
      const totalVested = decimal.add(vestedAfter47, finalTranche);
      expect(totalVested).toBe(1000);
    });

    test('should handle rounding at each vesting period vs. at the end', () => {
      // This test verifies that rounding at each period gives the same result
      // as calculating the end amount directly
      
      const sharesGranted = 999.999; // Just under 1000
      const monthlyVesting = decimal.divide(sharesGranted, 48);
      expect(monthlyVesting).toBe(20.833); // Same as for 1000 shares
      
      // Manual calculation of vesting for 48 months with rounding at each step
      let totalVested = 0;
      for (let i = 0; i < 48; i++) {
        const thisMonth = i === 47 
          ? decimal.calculateFinalTranche(sharesGranted, totalVested)
          : monthlyVesting;
        totalVested = decimal.add(totalVested, thisMonth);
      }
      
      // Final total should equal the original grant amount
      expect(totalVested).toBe(sharesGranted);
    });
  });
}); 