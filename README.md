# Digital Banking System API

A Node.js and Express banking API built for account registration, secure authentication, balance checks, and person-to-person money transfers.

## Overview

This project models a simple digital banking workflow with:

- Users linked to a single bank account
- Separate BVN/NIN onboarding and account creation
- BVN/NIN validation through the NIBSS integration layer
- JWT-based access tokens and refresh-token rotation
- Balance inquiry and transaction history
- Name enquiry and account-to-account transfers
- Security middleware for CORS, rate limiting, Helmet headers, and request hygiene

## Tech Stack

- Node.js 24
- Express.js
- MongoDB + Mongoose
- JWT for authentication
- bcryptjs for password hashing
- Axios for NIBSS API calls
- Helmet, CORS, express-rate-limit, hpp, cookie-parser

## Features

- Onboard the fintech with NibssByPhoenix before using provider APIs
- Validate BVN or NIN before creating a verified customer profile
- Create exactly one linked, pre-funded account through a protected endpoint
- Log in with account number and password
- Receive an access token in the response body and a refresh token in an HTTP-only cookie
- Refresh access tokens silently without re-logging in using background rotation
- Log out by invalidating access and refresh tokens via a dedicated database blacklist
- Get the authenticated user profile safely via middleware pipelines
- Fetch current account balance using resource-optimized direct ledger reads
- Perform name-enquiry lookups by account number supporting internal database checks and external bank network resolution via the NIBSS API sandbox
- Transfer funds between internal accounts using MongoDB session transactions, or route external transfers through NibssByPhoenix with durable pending, success, and failed states
- Return a list of transactions for the authenticated account sorted consistently with object ID tie-breakers

## Project Structure

```text
DigitalBankingSystem/
├── app.js                    # Express app configuration and middleware setup
├── server.js                 # Database connection and server bootstrap
├── package.json              # Scripts and dependencies
├── README.md                 # Project documentation
├── Controllers/
│   ├── authController.js     # Registration, login, refresh, logout, auth middleware
│   ├── transactionController.js # Name enquiry, transfer logic, transaction history
│   ├── userController.js     # Profile and balance endpoints
│   └── errorController.js    # Global error handling
├── Models/
│   ├── accountModel.js       # Account schema and balance logic
│   ├── blacklistModel.js     # Blacklisted JWT/session tokens
│   ├── transactionModel.js   # Transaction ledger schema
│   └── userModel.js          # User schema, password hashing, account linking
├── Routes/
│   ├── authRoutes.js         # Public auth routes
│   ├── userRoutes.js         # Authenticated user routes
│   └── transactionRoutes.js  # Authenticated banking routes
├── Services/
│   └── nibssService.js       # NibssByPhoenix API client and retry handling
├── Utils/
│   ├── apiFeatures.js
│   ├── appError.js
│   ├── catchAsync.js
│   ├── generateAccountNumber.js
│   ├── logger.js
│   └── ...
└── public/
```

## Prerequisites

- Node.js 24
- npm
- MongoDB instance or local MongoDB server

## Environment Variables

Create a `.env` file in the project root with the following variables:

```dotenv
NODE_ENV=development
PORT=5000
MONGO_CONNECTION=mongodb://127.0.0.1:27017/digitalbank

JWT_SECRET=replace-with-a-very-long-random-secret
JWT_EXPIRES_IN=10m
JWT_REFRESH_SECRET=replace-with-another-long-random-secret
JWT_REFRESH_EXPIRES_IN=1h

NIBSS_API_KEY=your_nibss_api_key
NIBSS_API_SECRET=your_nibss_api_secret
NIBSS_BASE_URL=https://nibssbyphoenix.onrender.com

# Optional live integration-test values. Use only NibssByPhoenix sandbox data.
NIBSS_INTEGRATION=false
NIBSS_TEST_ACCOUNT_NUMBER= sandbox-account-number
NIBSS_TEST_BVN=sandbox-bvn
# Or use NIBSS_TEST_NIN=sandbox-nin instead of a BVN.
```

Notes:

- `MONGO_CONNECTION` is required for Mongoose connection setup.
- `JWT_SECRET` and `JWT_REFRESH_SECRET` are required for access-token and refresh-token validation.
- `NIBSS_API_KEY` and `NIBSS_API_SECRET` are used by the registration and name-enquiry flows to authenticate to the external NIBSS services.
- Never commit real credentials or real BVN/NIN values. The live integration suite is opt-in and uses only sandbox identifiers.

## Installation

```bash
npm install
```

### Test the live NibssByPhoenix integration

Normal `npm test` uses the separate `digitalbank_test` database and does not
call NibssByPhoenix unless `NIBSS_INTEGRATION=true` is already set.
After placing sandbox credentials and identifiers in `.env`, run:

```powershell
$env:NIBSS_INTEGRATION="true"
npm run test:integration
```

The integration suite checks token generation, name enquiry, and BVN/NIN
validation against the configured provider. Account creation and transfers are
left as explicit API workflows because they create or move funds in the
provider sandbox.

## Run the Application

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm start
```

The server listens on the configured port, defaulting to `3000`.

## API Endpoints

Base URL:

```text
http://localhost:5000/api/v1
```

### Authentication

#### Onboard fintech

```http
POST /api/v1/auth/fintech-onboard
Content-Type: application/json
```

Request body:

```json
{
  "email": "bank@example.com",
  "companyName": "Example Bank"
}
```

NibssByPhoenix sends the API credentials to the submitted email. Store them as
`NIBSS_API_KEY` and `NIBSS_API_SECRET` in the environment.

#### Onboard customer

```http
POST /api/v1/auth/onboard
Content-Type: application/json
```

Request body:

```json
{
  "name": "Jae Doe",
  "password": "StrongPassword123",
  "dob": "1995-06-15",
  "bvn": "12345678901",
  "phone": "08012345678"
}
```

Provide exactly one of `bvn` or `nin` for a new customer. The API derives
first and last names from `name` unless they are supplied explicitly. It sends
the identity to `/api/insertBvn` or `/api/insertNin`, then verifies it. `phone`
is required when using BVN. If the identity already exists at NibssByPhoenix,
the API validates it and reuses the existing local customer after checking the
supplied password. Successful onboarding returns a local JWT for account
creation or account linking.

#### Create account

```http
POST /api/v1/users/account
Authorization: Bearer <onboarding-token>
```

This endpoint requires verified onboarding. It first checks NibssByPhoenix for
an existing account matching the customer's BVN/NIN and links it when found;
otherwise it creates a new provider account. The local account is pre-funded
with N15,000. A second account cannot be created for the same customer.

Inter-bank transfers retain the NibssByPhoenix transaction reference. The
transaction status endpoint uses `/api/transaction/{ref}` for those transfers;
intra-bank transfers use the local ledger status.

#### Login

```http
POST /api/v1/auth/login
Content-Type: application/json
```

Request body:

```json
{
  "account": "1001234567",
  "password": "StrongPassword123"
}
```

#### Refresh token

```http
POST /api/v1/auth/refresh-token
```

This reads the `refreshToken` cookie and returns a new access token.

#### Logout

```http
POST /api/v1/auth/logout
Authorization: Bearer <access-token>
```

This blacklists the active access token and refresh token, then clears the refresh cookie.

### User

#### Get current user profile

```http
GET /api/v1/users/me
Authorization: Bearer <access-token>
```

#### Add NIN to an existing customer

```http
PATCH /api/v1/users/me/identity
Authorization: Bearer <access-token>
Content-Type: application/json
```

Request body:

```json
{
  "nin": "00000000000"
}
```

The API validates the NIN with NibssByPhoenix before saving it. A NIN already
linked to another local customer is rejected with `409 Conflict`.

#### Get account balance

```http
GET /api/v1/users/balance
Authorization: Bearer <access-token>
```

### Transactions

#### Get my transactions

```http
GET /api/v1/transactions
Authorization: Bearer <access-token>
```

#### Name enquiry

```http
POST /api/v1/transactions/name-enquiry
Authorization: Bearer <access-token>
Content-Type: application/json
```

Request body:

```json
{
  "accountNumber": "1001234567"
}
```

#### Transfer funds

```http
POST /api/v1/transactions/transfer
Authorization: Bearer <access-token>
Content-Type: application/json
```

Request body:

```json
{
  "receivingAccountNumber": "6420193847",
  "amount": 2500,
  "description": "School fees disbursement"
}
```

Notes:

- Transfer amount must be greater than zero and uses a custom floating-point multiplier to protect currency precision decimal entries.
- The sender must have sufficient funds.
- **Routing Engine Matrix**: If the destination account number is matched locally, an internal wallet credit transaction occurs. Otherwise the request performs name enquiry and routes the transfer through NibssByPhoenix `/api/transfer`.
- **Transaction states**: Internal transfers use a MongoDB session transaction. External transfers create a `pending` ledger record before calling NibssByPhoenix, then become `success` or `failed`. A pending external transfer may require reconciliation if the provider succeeds but local finalization fails.

## Example Usage

### Onboard a customer

```bash
curl -X POST http://localhost:5000/api/v1/auth/onboard \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jae Doe",
    "password": "StrongPassword123",
    "dob": "1995-06-15",
    "bvn": "12345678901",
    "phone": "08012345678"
  }'
```

Copy the returned local `token`, then create or link the account:

```bash
curl -X POST http://localhost:5000/api/v1/users/account \
  -H "Authorization: Bearer <onboarding-token>"
```

### Login

```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "account": "1001234567",
    "password": "StrongPassword123"
  }'
```

### Get balance

```bash
curl http://localhost:5000/api/v1/users/balance \
  -H "Authorization: Bearer <access-token>"
```

### Transfer funds

```bash
curl -X POST http://localhost:5000/api/v1/transactions/transfer \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "receivingAccountNumber": "1002345678",
    "amount": 2500,
    "description": "School fees"
  }'
```

## Security Notes

- Passwords are hashed with `bcryptjs` before storage.
- Refresh tokens are stored in HTTP-only cookies.
- JWTs are blacklisted on logout to prevent reuse.
- Access is protected by `authController.protect` middleware.
- Global rate-limiting, Helmet security headers, and HPP protection are enabled.

## Notes

- Account numbers are generated by NibssByPhoenix and stored locally when the account is created or linked.
- Initial local account balances are set to N15,000.
- Internal transfers use database transactions; external transfers retain durable pending state because provider calls cannot be rolled back by MongoDB.

## License

This project is licensed under the ISC license.
