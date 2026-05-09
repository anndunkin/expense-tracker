# Changelog

All notable changes to ExpenseTrack are documented here.

---

## [1.0.3] — 2026-05-09

### Fixed
- **Windows shortcut activation collision with TimeTrack** — launching Expense Track while TimeTrack was already running would bring the TimeTrack window forward instead of starting Expense Track. Root cause: neither app called `app.setAppUserModelId()`, so Windows treated both Electron apps as the same application for shortcut routing, and the existing TimeTrack single-instance lock captured the activation.

### Changed
- `electron/main.cjs` now calls `app.setAppUserModelId("com.expensetrack.app")` on Windows before any other lifecycle hook.
- Added `app.requestSingleInstanceLock()` so a second launch of Expense Track focuses the existing window instead of spawning a duplicate process. Lock is scoped to the explicit AppUserModelID, eliminating cross-app collisions.
- The matching change has shipped in TimeTrack 1.2.2 (`com.timetrack.app`). Both apps must be on these versions or later for the fix to be complete.

---

## [1.0.2] — 2026-04-24

### Added
- **Input validation** — Zod schemas in `shared/schema.ts` now enforce strict rules on all numeric fields:
  - `amount`, `amountUsd`: must be finite and ≥ 0
  - `exchangeRate`: must be finite and > 0 (zero blocked — would corrupt totals)
  - `miles`: must be finite and ≥ 0; mileage items require miles > 0 (cross-field check via `superRefine`)
  - `currency`: validated against the 20 supported ISO codes
- **PATCH validation** — `updateExpenseItemSchema` applies the same per-field rules to partial updates (`PATCH /api/items/:id`)
- **HTTP 201 on item creation** — `POST /api/reports/:id/items` now returns `201 Created` (was `200`)

### Security (from 1.0.1)
- Removed `X-Powered-By: Express` header
- `DELETE /api/reports/:id` returns 404 for non-existent IDs (was silently returning `{ok:true}`)
- `POST /api/reports/:id/items` returns 404 if the parent report does not exist (prevents orphaned items)
- `DELETE /api/items/:id` returns 404 for non-existent items
- `DELETE /api/categories/:id` returns 404 for non-existent categories

### Tests
- 23 input validation tests (all passing)
- 75 boundary/totals-accuracy tests (all passing)

---

## [1.0.1] — 2026-04-24

### Fixed
- **Server startup on Windows** — removed `reusePort: true` from `httpServer.listen()` (Linux-only option, crashes on Windows)
- **Static file serving** — `server/static.ts` now reads the `STATIC_DIR` environment variable instead of using `path.resolve(__dirname, "public")`. In the packaged app, `__dirname` inside the bundled server resolves to `resources/server/`, not where the React frontend lives.
- **Electron main** — `main.cjs` sets `STATIC_DIR` to `resources/public/` before requiring the server bundle

### Security
- Removed `X-Powered-By: Express` header via `app.disable("x-powered-by")`
- Fixed IDOR: `DELETE /api/reports/:id` now returns 404 for non-existent reports
- Fixed IDOR: `POST /api/reports/:id/items` now returns 404 if parent report does not exist
- Fixed IDOR: `DELETE /api/items/:id` now validates existence
- Fixed IDOR: `DELETE /api/categories/:id` now validates existence
- Added `getCategory` to `IStorage` interface and implementation

### Tests
- 34 security tests covering SQL injection, path traversal, XSS, mass assignment, HTTP method tampering, malformed input, IDOR, and header injection (all passing)

---

## [1.0.0] — 2026-04-23

### Initial release

#### Features
- Monthly and travel expense reports
- Categories:
  - Monthly: Equipment, Supplies, Rental Cars, Gas, Public Transportation, Meals, Meeting Registration, Software & Subscriptions, Mileage Reimbursement, Miscellaneous
  - Travel: Airfare, Public Transportation, Rental Car, Gas, Meals, Meeting Registration, Supplies, Mileage Reimbursement, Miscellaneous
- Mileage reimbursement at 2026 IRS rate ($0.725/mile)
- Foreign currency entry with live exchange rate conversion (20 currencies)
- Corporate credit card tracking — items split into reimbursable vs. corporate card subtotals
- Tax deductibility reporting — all items 100% deductible except meals (50%)
- File menu: New, Open, Save, Save As (`.etf` JSON format)
- Print-formatted report output
- Custom category management
- Dark mode support

#### Packaging
- Delivered as Windows x64 desktop application (Electron 41, ABI 145)
- Self-contained zip: ~138 MB, 81 files
- SQLite database persisted to `%APPDATA%/ExpenseTrack/data.db`
- All server dependencies bundled into a single `dist/index.cjs` via esbuild (down from 38,000 files)

#### Architecture
- Express server runs in-process inside Electron (no child process)
- Native `better-sqlite3` binding loaded via `BETTER_SQLITE3_BINDING` environment variable
- React frontend served from `STATIC_DIR` environment variable
