const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../app');
const User = require('../Models/userModel');
const Account = require('../Models/accountModel');
const Transaction = require('../Models/transactionModel');
const { generateAccountNumber } = require('../Utils/generateAccountNumber');

// Configuration setup before tests execute
test.before(async () => {
  // Overrides secrets for isolated testing environment safely
  process.env.JWT_SECRET =
    'native_test_suite_super_secret_string_longer_than_normal_requirements';
  process.env.JWT_REFRESH_SECRET =
    'native_test_suite_super_secret_refresh_string_longer_than_normal_requirements';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.JWT_REFRESH_EXPIRES_IN = '2h';
  process.env.NODE_ENV = 'test';

  // Connects to the development/test collection safely
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(
      process.env.MONGO_TEST_CONNECTION ||
        'mongodb://127.0.0.1:27017/digitalbank_test'
    );
  }
  await User.cleanIndexes();
  await User.syncIndexes();
});

// Clean up after all tests complete
test.after(async () => {
  await mongoose.disconnect();
});

// Setup function to seed database state before each test scenario
async function setupTestData() {
  await User.deleteMany({});
  await Account.deleteMany({});
  await Transaction.deleteMany({});

  // Create verified customers before creating their accounts.
  const senderUser = await User.create({
    name: 'Sender Customer',
    password: 'Password123!',
    dob: '1990-01-01',
    bvn: '11111111111',
    onboardingStatus: 'verified'
  });
  const senderAccount = await Account.create({
    accountNumber: await generateAccountNumber(),
    user: senderUser._id
  });
  senderUser.account = senderAccount._id;
  await senderUser.save();

  // Create Receiver
  const receiverUser = await User.create({
    name: 'Receiver Customer',
    password: 'Password123!',
    dob: '1991-01-01',
    bvn: '22222222222',
    onboardingStatus: 'verified'
  });
  const receiverAccount = await Account.create({
    accountNumber: await generateAccountNumber(),
    user: receiverUser._id
  });
  receiverUser.account = receiverAccount._id;
  await receiverUser.save();

  // Log sender in to retrieve valid access token
  const loginRes = await request(app).post('/api/v1/auth/login').send({
    account: senderAccount.accountNumber,
    password: 'Password123!'
  });

  return {
    token: loginRes.body.token,
    senderAccount,
    receiverAccount,
    senderUser,
    receiverUser
  };
}

test('Digital Banking Fund Transfer Engine Matrix Validation', async t => {
  // Successful transfer
  await t.test(
    'should successfully complete an internal fund transfer when parameters are valid',
    async () => {
      const data = await setupTestData();

      const res = await request(app)
        .post('/api/v1/transactions/transfer')
        .set('Authorization', `Bearer ${data.token}`)
        .send({
          receivingAccountNumber: data.receiverAccount.accountNumber,
          amount: 5000,
          description: 'Payment for groceries'
        });

      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.status, 'success');

      // Handle adaptive database unpacking safely
      const txData = Array.isArray(res.body.data.transaction)
        ? res.body.data.transaction[0]
        : res.body.data.transaction;

      assert.strictEqual(txData.status, 'success');

      // Verify balance deductions mathematically
      const updatedSender = await Account.findById(data.senderAccount._id);
      const updatedReceiver = await Account.findById(data.receiverAccount._id);
      assert.strictEqual(updatedSender.balance, 10000); // 15000 - 5000
      assert.strictEqual(updatedReceiver.balance, 20000); // 15000 + 5000
    }
  );

  // Insufficient balance
  await t.test(
    'should reject the transfer if the sender balance is too low',
    async () => {
      const data = await setupTestData();

      const res = await request(app)
        .post('/api/v1/transactions/transfer')
        .set('Authorization', `Bearer ${data.token}`)
        .send({
          receivingAccountNumber: data.receiverAccount.accountNumber,
          amount: 20000, // Exceeds default 15000 wallet limit
          description: 'Overdraft test attempt'
        });

      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /Insufficient account balance/i);

      // Verify a failed transaction audit receipt was logged
      const failedLog = await Transaction.findOne({ status: 'failed' });
      assert.ok(failedLog);
    }
  );

  // Invalid amount
  await t.test(
    'should reject requests where the input amount is zero or negative',
    async () => {
      const data = await setupTestData();

      const res = await request(app)
        .post('/api/v1/transactions/transfer')
        .set('Authorization', `Bearer ${data.token}`)
        .send({
          receivingAccountNumber: data.receiverAccount.accountNumber,
          amount: -1500,
          description: 'Negative payload attack vector'
        });

      assert.strictEqual(res.statusCode, 400);
      assert.match(
        res.body.message,
        /Transaction amount must be greater than zero/i
      );
    }
  );

  // Self-transfer
  await t.test(
    'should prevent users from sending money to their own account parameters',
    async () => {
      const data = await setupTestData();

      const res = await request(app)
        .post('/api/v1/transactions/transfer')
        .set('Authorization', `Bearer ${data.token}`)
        .send({
          receivingAccountNumber: data.senderAccount.accountNumber, // Sending to themselves
          amount: 1000,
          description: 'Self loops loop'
        });

      assert.strictEqual(res.statusCode, 400);
      assert.match(res.body.message, /You cannot transfer money to yourself/i);
    }
  );

  // Unknown receiving account (External Payout Routing)
  await t.test(
    'should attempt an external routing flow or drop if interbank fails gracefully',
    async () => {
      const data = await setupTestData();

      const res = await request(app)
        .post('/api/v1/transactions/transfer')
        .set('Authorization', `Bearer ${data.token}`)
        .send({
          receivingAccountNumber: '9999999999', // Non-existent local account
          amount: 1000,
          description: 'Interbank test routing pipeline'
        });

      // Validates that it correctly tries to hit NIBSS routing and throws our handled 404 block
      assert.strictEqual(res.statusCode, 404);
      assert.match(res.body.message, /Destination external account not found/i);
    }
  );

  // Transaction history lookup
  await t.test(
    'should cleanly pull the active statements history for the customer profile',
    async () => {
      const data = await setupTestData();

      // Directly seed a successful transaction log in the database
      await Transaction.create({
        senderAccount: data.senderAccount._id,
        senderAccountNumber: data.senderAccount.accountNumber,
        senderName: data.senderUser.name,
        receivingAccount: data.receiverAccount._id,
        receivingAccountNumber: data.receiverAccount.accountNumber,
        receivingName: data.receiverUser.name,
        amount: 1200,
        description: 'Historical test lookup seed',
        type: 'transfer',
        status: 'success'
      });

      const res = await request(app)
        .get('/api/v1/transactions')
        .set('Authorization', `Bearer ${data.token}`);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.status, 'success');
      assert.strictEqual(res.body.results, 1);
      assert.strictEqual(
        res.body.data.transactions[0].description,
        'Historical test lookup seed'
      );
    }
  );

  // Transaction Status Check & Privacy Isolation
  await t.test(
    'should allow users to check status of their own transactions but block unauthorized eyes',
    async () => {
      const data = await setupTestData();

      // 1. Seed a sample tracking receipt log
      const testTx = await Transaction.create({
        senderAccount: data.senderAccount._id,
        senderAccountNumber: data.senderAccount.accountNumber,
        senderName: data.senderUser.name,
        receivingAccount: data.receiverAccount._id,
        receivingAccountNumber: data.receiverAccount.accountNumber,
        receivingName: data.receiverUser.name,
        amount: 4500,
        description: 'Status verify target log',
        type: 'transfer',
        status: 'success'
      });

      // Execute status check lookup matching authorization limits
      const res = await request(app)
        .get(`/api/v1/transactions/${testTx._id}/status`)
        .set('Authorization', `Bearer ${data.token}`);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.status, 'success');
      assert.strictEqual(res.body.data.status, 'success');
    }
  );

  await t.test(
    'should return the current user profile and balance',
    async () => {
      const data = await setupTestData();

      const profileRes = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${data.token}`);
      assert.strictEqual(profileRes.statusCode, 200);
      assert.strictEqual(profileRes.body.data.user.name, 'Sender Customer');
      assert.strictEqual(profileRes.body.data.user.password, undefined);

      const balanceRes = await request(app)
        .get('/api/v1/users/balance')
        .set('Authorization', `Bearer ${data.token}`);
      assert.strictEqual(balanceRes.statusCode, 200);
      assert.strictEqual(balanceRes.body.data.balance, 15000);
    }
  );

  await t.test(
    'should resolve a local account name before using NIBSS',
    async () => {
      const data = await setupTestData();

      const res = await request(app)
        .post('/api/v1/transactions/name-enquiry')
        .set('Authorization', `Bearer ${data.token}`)
        .send({ accountNumber: data.receiverAccount.accountNumber });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.data.name, 'Receiver Customer');
      assert.strictEqual(
        res.body.data.accountNumber,
        data.receiverAccount.accountNumber
      );
    }
  );

  await t.test(
    'should block a third user from another customer transaction',
    async () => {
      const data = await setupTestData();
      const outsider = await User.create({
        name: 'Outsider Customer',
        password: 'Password123!',
        dob: '1992-01-01',
        bvn: '33333333333',
        onboardingStatus: 'verified'
      });
      const outsiderAccount = await Account.create({
        accountNumber: await generateAccountNumber(),
        user: outsider._id
      });
      outsider.account = outsiderAccount._id;
      await outsider.save();

      const transaction = await Transaction.create({
        senderAccount: data.senderAccount._id,
        senderAccountNumber: data.senderAccount.accountNumber,
        senderName: data.senderUser.name,
        receivingAccount: data.receiverAccount._id,
        receivingAccountNumber: data.receiverAccount.accountNumber,
        receivingName: data.receiverUser.name,
        amount: 100,
        description: 'Private transaction',
        type: 'transfer',
        status: 'success'
      });
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        account: outsiderAccount.accountNumber,
        password: 'Password123!'
      });

      const res = await request(app)
        .get(`/api/v1/transactions/${transaction._id}/status`)
        .set('Authorization', `Bearer ${loginRes.body.token}`);

      assert.strictEqual(res.statusCode, 403);
    }
  );

  await t.test('should refresh and revoke authenticated sessions', async () => {
    const data = await setupTestData();
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      account: data.senderAccount.accountNumber,
      password: 'Password123!'
    });
    const cookies = loginRes.headers['set-cookie'];

    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', cookies);
    assert.strictEqual(refreshRes.statusCode, 200);
    assert.strictEqual(typeof refreshRes.body.token, 'string');

    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
      .set('Cookie', cookies);
    assert.strictEqual(logoutRes.statusCode, 200);

    const protectedRes = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${loginRes.body.token}`);
    assert.strictEqual(protectedRes.statusCode, 401);
  });
});
