const crypto = require('crypto');

/**
 * Generates a mathematically valid 10-digit Nigerian NUBAN account number
 * using the official Central Bank of Nigeria (CBN) algorithmic formula.
 */
exports.generateAccountNumber = async () => {
  // Define the unique 3-digit Fintech Bank Code
  const bankCode = '642';

  // Generate 9 random digits for the main account sequence safely via crypto
  const serialNumber = Array.from({ length: 9 }, () =>
    crypto.randomInt(0, 10)
  ).join('');

  // Calculate NUBAN Check Digit using CBN weights: 3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3
  const combined = bankCode + serialNumber;
  const weights = [3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3];
  let sum = 0;
  for (let i = 0; i < combined.length; i++) {
    sum += parseInt(combined[i], 10) * weights[i];
  }

  // Formula: Check Digit = 10 - (Sum modulo 10). If result is 10, check digit is 0.
  const moduloResult = sum % 10;
  const checkDigit = moduloResult === 0 ? 0 : 10 - moduloResult;

  // Combine the 9 serial digits with the 10th check digit to form the NUBAN
  return `${serialNumber}${checkDigit}`;
};
