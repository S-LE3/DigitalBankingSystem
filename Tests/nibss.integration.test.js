require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const nibssService = require('../Services/nibssService');

const requiredVariables = [
  'NIBSS_API_KEY',
  'NIBSS_API_SECRET',
  'NIBSS_TEST_ACCOUNT_NUMBER'
];
const missingVariables = requiredVariables.filter(
  variable => !process.env[variable]
);
const integrationEnabled = process.env.NIBSS_INTEGRATION === 'true';

const liveTest = integrationEnabled ? test : test.skip;

liveTest('NIBSS credentials generate a provider token', async () => {
  if (missingVariables.length) {
    throw new Error(
      `Missing integration variables: ${missingVariables.join(', ')}`
    );
  }

  const token = await nibssService.getToken();
  assert.equal(typeof token, 'string');
  assert.ok(token.length > 0);
});

liveTest(
  'NIBSS name enquiry resolves the configured sandbox account',
  async () => {
    if (missingVariables.length) {
      throw new Error(
        `Missing integration variables: ${missingVariables.join(', ')}`
      );
    }

    const response = await nibssService.nameEnquiry(
      process.env.NIBSS_TEST_ACCOUNT_NUMBER
    );
    assert.equal(response.status, 200);
  }
);

liveTest(
  'NIBSS identity validation resolves configured sandbox KYC data',
  async () => {
    if (missingVariables.length) {
      throw new Error(
        `Missing integration variables: ${missingVariables.join(', ')}`
      );
    }

    const identity = process.env.NIBSS_TEST_BVN
      ? { bvn: process.env.NIBSS_TEST_BVN }
      : { nin: process.env.NIBSS_TEST_NIN };

    if (!identity.bvn && !identity.nin) {
      throw new Error('Set NIBSS_TEST_BVN or NIBSS_TEST_NIN.');
    }

    const response = await nibssService.verifyIdentity(identity);
    assert.equal(response.status, 200);
  }
);
