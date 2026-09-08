# Test Results

Test date: 2026-09-08

## Automated Tests

Command:

```powershell
npm test
```

Result:

```text
17 tests passed
0 failed
0 cancelled
```

## Live NIBSS Integration Tests

Commands:

```powershell
$env:NIBSS_INTEGRATION = "true"
$env:NIBSS_TEST_ACCOUNT_NUMBER = "<sandbox-account-number>"
$env:NIBSS_TEST_BVN = "<sandbox-bvn>"
npm run test:integration
```

Result:

```text
3 tests passed
0 failed
0 skipped
```

The live tests covered provider token generation, account name enquiry, and BVN validation. Credentials, tokens, account identifiers, and personal data are intentionally omitted from this submission artifact.

## Code Quality

```text
ESLint passed
```
