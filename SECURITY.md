# Security

This document describes the security controls, input validation rules, and known posture of the ExpenseTrack application.

---

## Validation

All data written to the database is validated server-side using [Zod](https://zod.dev/) schemas defined in `shared/schema.ts`. Validation runs on both `POST` (create) and `PATCH` (update) paths. Invalid requests return HTTP `400` with a structured error body — they are never persisted.

### Expense item field rules

| Field | Rule | Rationale |
|---|---|---|
| `amount` | finite, ≥ 0 | Prevents negative amounts from subtracting from totals |
| `amountUsd` | finite, ≥ 0 | Prevents corrupting USD subtotals |
| `exchangeRate` | finite, > 0 | Zero would cause division corruption; negative would invert totals |
| `miles` | finite, ≥ 0 | Non-mileage items default to 0; mileage items must have miles > 0 |
| `miles` (mileage item) | > 0 when `isMileage = true` | Cross-field check via `superRefine` |
| `currency` | one of 20 allowed codes | Rejects unsupported or fabricated currency codes |

### What "finite" means

JavaScript IEEE-754 doubles can represent `Infinity` and `NaN`. The `z.number().finite()` constraint rejects both. Note: `Infinity` cannot be expressed in JSON (the JSON spec does not allow it), so this defense-in-depth check catches values that arrive via non-standard clients or code paths.

### PATCH validation

`PATCH /api/items/:id` uses a separate `updateExpenseItemSchema` — a partial version of the insert schema with the same per-field rules but all fields optional. This ensures partial updates (e.g., toggling `billedToCard`) cannot slip through with invalid numeric values.

---

## Security Headers

- `X-Powered-By` header is removed via `app.disable("x-powered-by")` so the Express version is not advertised in responses.

---

## Injection Defenses

### SQL Injection
All database access uses the Drizzle ORM query builder with parameterized queries. Raw SQL is used only in the one-time schema migration block (`sqlite.exec(...)` at startup), which contains no user input.

### Path Traversal
The API does not accept file paths from user input. File paths used internally (SQLite db location, native binding, server bundle) are constructed from fixed environment variables set by `electron/main.cjs`.

### XSS
The frontend is a React SPA. React escapes all dynamic content rendered via JSX by default. There are no calls to `dangerouslySetInnerHTML`.

### Header Injection
All HTTP responses use Express's `res.json()` which sets `Content-Type: application/json` and encodes values safely. No user input is placed directly into response headers.

### IDOR
All item and category mutations verify existence before operating:
- `DELETE /api/reports/:id` — 404 if report not found
- `DELETE /api/items/:id` — 404 if item not found
- `DELETE /api/categories/:id` — 404 if category not found
- `POST /api/reports/:id/items` — 404 if parent report not found (prevents orphaned items)

### Mass Assignment
All insert and update operations go through explicit Zod schemas with `.omit({ id: true })`. Auto-generated fields (primary keys) cannot be set by the client.

### HTTP Method Tampering
Express only registers handlers for the specific HTTP methods used. Unregistered method/path combinations return the framework default (404 or 405).

---

## Local Application Scope

ExpenseTrack is a local desktop application. The Express server binds to `localhost:5000` only — it is not accessible from other machines on the network.

There is no authentication layer because the application is single-user and local. User data is stored in `%APPDATA%/ExpenseTrack/data.db`.

---

## Exchange Rate API

Live exchange rates are fetched from `open.er-api.com` (no API key required for basic rates). Rates are cached for 1 hour. If the external service is unavailable, the last cached rate is served. The application falls back gracefully; it does not crash or block on network failures.

---

## Reporting a Vulnerability

This is a private application. If you discover a security issue, please contact the repository owner directly.
