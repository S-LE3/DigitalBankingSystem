const axios = require('axios');

const baseUrl =
  process.env.NIBSS_BASE_URL || 'https://nibssbyphoenix.onrender.com';
const requestOptions = { timeout: 15000 };

const postWithRetry = async (
  url,
  payload,
  config = {},
  operation = 'NIBSS request'
) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await axios.post(url, payload, { ...requestOptions, ...config });
    } catch (error) {
      error.nibssOperation = operation;
      const isTransient = !error.response || error.response.status >= 500;
      if (!isTransient || attempt === 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
};

const getWithRetry = async (url, config = {}, operation = 'NIBSS request') => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await axios.get(url, { ...requestOptions, ...config });
    } catch (error) {
      error.nibssOperation = operation;
      const isTransient = !error.response || error.response.status >= 500;
      if (!isTransient || attempt === 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
};

const getToken = async () => {
  const response = await postWithRetry(
    `${baseUrl}/api/auth/token`,
    {
      apiKey: process.env.NIBSS_API_KEY,
      apiSecret: process.env.NIBSS_API_SECRET
    },
    {},
    'NIBSS token generation'
  );

  return response.data.token;
};

exports.onboardFintech = async ({ email, companyName }) => {
  return axios.post(`${baseUrl}/api/fintech/onboard`, {
    name: companyName,
    email
  });
};

exports.verifyIdentity = async ({ bvn, nin }) => {
  const token = await getToken();
  const identity = bvn ? { bvn } : { nin };
  const endpoint = bvn ? 'validateBvn' : 'validateNin';

  return postWithRetry(
    `${baseUrl}/api/${endpoint}`,
    identity,
    {
      headers: { Authorization: `Bearer ${token}` }
    },
    `NIBSS ${endpoint}`
  );
};

exports.insertIdentity = async ({
  name,
  password,
  bvn,
  nin,
  firstName,
  lastName,
  dob,
  phone
}) => {
  const token = await getToken();
  const isBvn = Boolean(bvn);
  const endpoint = isBvn ? 'insertBvn' : 'insertNin';
  const payload = isBvn
    ? { name, password, bvn, dob, phone }
    : { nin, firstName, lastName, dob };

  return postWithRetry(
    `${baseUrl}/api/${endpoint}`,
    payload,
    {
      headers: { Authorization: `Bearer ${token}` }
    },
    `NIBSS ${endpoint}`
  );
};

exports.nameEnquiry = async accountNumber => {
  const token = await getToken();

  return getWithRetry(
    `${baseUrl}/api/account/name-enquiry/${accountNumber}`,
    { headers: { Authorization: `Bearer ${token}` } },
    'NIBSS name enquiry'
  );
};

exports.listAccounts = async () => {
  const token = await getToken();

  return getWithRetry(
    `${baseUrl}/api/accounts`,
    { headers: { Authorization: `Bearer ${token}` } },
    'NIBSS account listing'
  );
};

exports.createAccount = async ({ bvn, nin, dob }) => {
  const token = await getToken();
  const payload = {
    kycType: bvn ? 'bvn' : 'nin',
    kycID: bvn || nin,
    dob
  };

  return postWithRetry(
    `${baseUrl}/api/account/create`,
    payload,
    {
      headers: { Authorization: `Bearer ${token}` }
    },
    'NIBSS account creation'
  );
};

exports.transfer = async ({ from, to, amount }) => {
  const token = await getToken();

  return postWithRetry(
    `${baseUrl}/api/transfer`,
    { from, to, amount },
    { headers: { Authorization: `Bearer ${token}` } },
    'NIBSS transfer'
  );
};

exports.getTransaction = async reference => {
  const token = await getToken();

  return getWithRetry(
    `${baseUrl}/api/transaction/${reference}`,
    { headers: { Authorization: `Bearer ${token}` } },
    'NIBSS transaction status'
  );
};

exports.getToken = getToken;
