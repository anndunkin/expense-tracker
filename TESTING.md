# Testing

This document describes the test coverage for ExpenseTrack. All tests run against the live Express server (`http://localhost:5000`) using direct HTTP calls.

---

## Running Tests

Start the development server first:
```bash
npm run dev
```

Then run the test suite with Python 3:
```bash
# Security tests
python3 tests/security_tests.py

# Input validation tests
python3 tests/validation_tests.py

# Boundary / totals accuracy tests
python3 tests/boundary_tests.py
```

---

## Test Coverage

### 1. Security Tests — 34 tests

Located in `tests/security_tests.py`. Covers 8 attack categories:

| Category | Tests | What's verified |
|---|---|---|
| SQL Injection | 4 | Payloads in name, category, notes, currency fields don't alter query results |
| Path Traversal | 4 | `../` sequences in string fields stored as literal text, not resolved as paths |
| XSS | 4 | `<script>` and event handler payloads stored and returned as literal strings |
| Mass Assignment | 3 | `id` field cannot be set by the client; auto-increment enforced |
| HTTP Method Tampering | 4 | PUT/PATCH/DELETE on read-only endpoints return 404/405 |
| Malformed Input | 5 | Missing required fields, wrong types, oversized strings rejected cleanly |
| IDOR | 6 | Operations on non-existent IDs return 404; items cannot cross report boundaries |
| Header Injection | 4 | `X-Powered-By` absent; CRLF sequences in fields don't split responses |

**All 34 tests pass.**

---

### 2. Input Validation Tests — 23 tests

Located in `tests/validation_tests.py`. Verifies the Zod validation rules in `shared/schema.ts`:

| Field | Tests | Cases covered |
|---|---|---|
| `miles` | 6 | Non-numeric string, negative, zero on mileage item, valid integer, valid float, PATCH negative |
| Foreign currency `amount` | 5 | Negative amount, negative amountUsd, zero exchange rate, negative exchange rate, unsupported currency code |
| Mixed validation | 6 | Non-mileage item with zero amount (allowed), mileage item with zero miles (rejected), valid FX item |
| PATCH path | 6 | Same rules enforced on updates as on creates |

**All 23 tests pass.**

---

### 3. Boundary Tests — 75 tests

Located in `tests/boundary_tests.py`. Verifies that report-level totals stay accurate when valid, rejected, and foreign-currency entries coexist.

| Block | Tests | What's verified |
|---|---|---|
| Mileage mix (valid + rejected) | 9 | Only valid miles accumulate; negative/zero/string inputs not persisted |
| Mileage boundary values | 6 | 0.1 mi minimum, 99,999 mi large value, zero rejected; USD total = miles × 0.725 |
| Corp card mixed entries | 10 | Reimbursable and card buckets isolated; rejected items don't leak into either |
| Corp card edge cases | 13 | All-card (reimb=0), all-reimb (card=0), PATCH billedToCard flip updates both buckets correctly |
| Foreign currency + corp card | 9 | Only `amountUsd` flows into totals; zero/negative exchange rates blocked |
| Full mixed scenario | 13 | Mileage + FX + USD + corp card + 4 rejected inputs coexist; each total is exact |
| PATCH corruption prevention | 11 | Bad PATCHes leave totals unchanged; valid PATCH updates only the correct bucket |
| Mileage isolation | 4 | Non-mileage items with miles=0 don't inflate the miles total |

**All 75 tests pass.**

---

## Total: 132 tests, 132 passing

---

## What Is Not Covered

- **Frontend unit tests** — React component logic is not unit tested. Calculation logic (totals, mileage, currency conversion) is tested at the API level.
- **End-to-end UI tests** — No Playwright/Selenium tests against the browser UI.
- **Performance tests** — No load or stress testing. This is a single-user local application.
- **Electron packaging tests** — The packaged `.exe` is not automatically tested; it is manually verified on a Windows machine.
