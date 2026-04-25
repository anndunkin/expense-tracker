# Tests

All tests are integration tests that run against the live Express server. Start the dev server before running any test file.

```bash
# Terminal 1 — start the server
npm run dev

# Terminal 2 — run tests
python3 tests/security_tests.py
python3 tests/validation_tests.py
python3 tests/boundary_tests.py
```

| File | Tests | Description |
|---|---|---|
| `security_tests.py` | 34 | SQL injection, path traversal, XSS, mass assignment, HTTP method tampering, malformed input, IDOR, header injection |
| `validation_tests.py` | 23 | Mileage miles field, foreign currency amounts, exchange rates, PATCH path |
| `boundary_tests.py` | 75 | Mileage totals, corp card subtotals, mixed scenarios, PATCH corruption prevention |

**Total: 132 tests, 132 passing.**
