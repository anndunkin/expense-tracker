# ExpenseTrack

A professional desktop expense reporting application for Windows. Supports monthly and travel expense reports with foreign currency conversion, corporate credit card tracking, mileage reimbursement, and printable PDF-ready output.

---

## Features

### Report Types
- **Monthly** — Equipment, Supplies, Rental Cars, Gas, Public Transportation, Meals, Meeting Registration, Software & Subscriptions, Mileage Reimbursement, Miscellaneous
- **Travel** — Airfare, Public Transportation, Rental Car, Gas, Meals, Meeting Registration, Supplies, Mileage Reimbursement, Miscellaneous

### Financial Tracking
- **Mileage reimbursement** — enter miles; amount calculated automatically at the current IRS federal rate ($0.725/mile for 2026)
- **Foreign currency** — enter amounts in any of 20 supported currencies; live exchange rates convert to USD automatically; both original and USD amounts appear on the report
- **Corporate credit card** — mark individual items as billed to corporate card; report totals split between reimbursable and corporate card amounts
- **Tax deductibility** — all items are 100% deductible except meals (50%); tax-deductible subtotal calculated automatically

### File Management
- **New / Open / Save / Save As** — full file menu for managing `.etf` (JSON) report files
- Reports can be saved mid-entry and reopened at any time
- Import/export via the API for programmatic access

### Output
- **Print** — browser print dialog with a clean, formatted layout optimized for letter-size paper
- All totals, subtotals, and currency conversions displayed on screen and in the printed report

---

## Technology Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Electron](https://www.electronjs.org/) 41 (ABI 145) |
| Frontend | [React](https://react.dev/) 18, [Vite](https://vite.dev/) 7, [Tailwind CSS](https://tailwindcss.com/) 3, [shadcn/ui](https://ui.shadcn.com/) |
| Backend | [Express](https://expressjs.com/) 5 (runs in-process inside Electron) |
| Database | [SQLite](https://www.sqlite.org/) via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) 12 + [Drizzle ORM](https://orm.drizzle.team/) |
| Validation | [Zod](https://zod.dev/) — enforced on every API write path |
| Exchange rates | [open.er-api.com](https://www.exchangerate-api.com/) (free tier, no key required) — 1-hour cache |
| Bundler | [esbuild](https://esbuild.github.io/) — all server dependencies bundled to a single `dist/index.cjs` |
| Packaging | [electron-builder](https://www.electron.build/) — produces a self-contained zip (81 files) |

---

## Architecture

```
ExpenseTrack.exe  (Electron shell)
│
├── electron/main.cjs          Electron entry point
│   ├── Starts Express server in-process via require()
│   ├── Sets DATA_DIR, PORT, BETTER_SQLITE3_BINDING, STATIC_DIR env vars
│   └── Polls http://localhost:5000 until ready, then opens BrowserWindow
│
├── resources/server/index.cjs  Express server (all deps bundled by esbuild)
│   ├── server/routes.ts        REST API routes
│   ├── server/storage.ts       Drizzle ORM data access layer
│   └── server/static.ts        Serves React frontend from STATIC_DIR
│
├── resources/public/           Built React frontend (Vite output)
│   └── index.html + assets/
│
└── resources/native/
    └── better_sqlite3.node     Windows x64 native SQLite binding (ABI 145)
```

### Key design decisions

**In-process server** — Express runs inside the Electron renderer process via `require(serverBundle)` rather than as a child process. This eliminates the complexity of IPC and process management, and means the frontend talks to the backend over plain `localhost:5000` HTTP.

**Single-file bundle** — esbuild bundles all Node.js dependencies into `dist/index.cjs`. Only the native `.node` binary is excluded (it cannot be bundled). This keeps the distributed package at ~81 files instead of 38,000+.

**Persistent storage** — SQLite database stored in `%APPDATA%/ExpenseTrack/data.db`. Data survives app restarts and is separate from the application installation directory.

**No asar** — `asar: false` in electron-builder config; native binary path resolution requires real filesystem paths.

---

## Development Setup

### Prerequisites
- Node.js 20+
- npm 10+

### Install dependencies
```bash
cd expense-tracker
npm install
```

### Run in development mode
```bash
npm run dev
```
Starts the Express server (port 5000) and Vite dev server on the same port. Hot reload is active for frontend changes.

### Build for production (web only)
```bash
npm run build
```
Produces:
- `dist/public/` — compiled React frontend
- `dist/index.cjs` — bundled Express server

### Build Windows app
```bash
# Requires the Windows ABI-145 native binary in node_modules/better-sqlite3/build/Release/
npm run build:electron
```
Output: `dist-electron/win-unpacked/` and `dist-electron/ExpenseTrack-1.0.2-Windows-x64.zip`

> **Note for cross-compilation:** Building on Linux requires the Windows prebuilt binary for `better-sqlite3`. Download `better-sqlite3-v12.9.0-electron-v145-win32-x64.tar.gz` from the [better-sqlite3 releases page](https://github.com/WiseLibs/better-sqlite3/releases) and extract `better_sqlite3.node` to `node_modules/better-sqlite3/build/Release/` before running electron-builder.

---

## API Reference

All endpoints are served at `http://localhost:5000`.

### Reports

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/reports` | List all reports |
| `GET` | `/api/reports/:id` | Get report + all items |
| `POST` | `/api/reports` | Create report |
| `PATCH` | `/api/reports/:id` | Update report metadata |
| `DELETE` | `/api/reports/:id` | Delete report |
| `POST` | `/api/reports/import` | Bulk import report + items |

### Expense Items

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/reports/:id/items` | List items for a report |
| `POST` | `/api/reports/:id/items` | Add item (validated) |
| `PATCH` | `/api/items/:id` | Update item (validated) |
| `DELETE` | `/api/items/:id` | Delete item |

### Categories

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/categories/:type` | List categories for report type |
| `POST` | `/api/categories` | Create custom category |
| `PATCH` | `/api/categories/:id` | Update category |
| `DELETE` | `/api/categories/:id` | Delete category |

### Exchange Rates

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/exchange-rate/:code` | Get USD rate for currency code (cached 1 hour) |

---

## Supported Currencies

`USD` `EUR` `GBP` `CAD` `MXN` `JPY` `AUD` `CHF` `CNY` `INR` `BRL` `KRW` `SGD` `HKD` `NZD` `SEK` `NOK` `DKK` `ZAR` `AED`

---

## Data Model

### `expense_reports`
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT | Report name |
| `type` | TEXT | `"monthly"` or `"travel"` |
| `submitter_name` | TEXT | Person submitting |
| `trip_purpose` | TEXT | Travel purpose (travel reports) |
| `date_submitted` | TEXT | ISO date string |
| `status` | TEXT | `"draft"` or `"complete"` |

### `expense_items`
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `report_id` | INTEGER | FK → expense_reports |
| `date` | TEXT | Expense date |
| `category` | TEXT | Expense category |
| `amount` | REAL | Amount in original currency |
| `currency` | TEXT | ISO currency code |
| `amount_usd` | REAL | Converted USD amount (used in all totals) |
| `exchange_rate` | REAL | Rate used for conversion |
| `is_mileage` | INTEGER (bool) | True for mileage reimbursement items |
| `miles` | REAL | Miles driven (mileage items only) |
| `billed_to_card` | INTEGER (bool) | True if charged to corporate credit card |
| `notes` | TEXT | Optional notes |
| `sort_order` | INTEGER | Display order within report |

---

## License

MIT
