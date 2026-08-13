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
| Desktop shell | [Electron](https://www.electronjs.org/) 43 |
| Frontend | [React](https://react.dev/) 19, [Vite](https://vite.dev/) 8, [Tailwind CSS](https://tailwindcss.com/) 4, [shadcn/ui](https://ui.shadcn.com/) |
| Backend | [Express](https://expressjs.com/) 5 (runs in-process inside Electron) |
| Database | [SQLite](https://www.sqlite.org/) via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) 12 + [Drizzle ORM](https://orm.drizzle.team/) |
| Validation | [Zod](https://zod.dev/) 4 — enforced on every API write path |
| Exchange rates | [open.er-api.com](https://www.exchangerate-api.com/) (free tier, no key required) — 1-hour cache |
| Bundler | [Vite](https://vite.dev/) 8 + [esbuild](https://esbuild.github.io/) — client and single-file `dist/index.cjs` server bundle |
| Packaging | [electron-builder](https://www.electron.build/) 26 — produces a self-contained zip |

---

## Dependency modernization (v1.1.3)

The August 2026 modernization updates Electron to 43.4.0, React/React DOM to
19.2.8, Vite to 8.2.1, Tailwind CSS to 4.3.3, TypeScript to 7.0.2, Zod to
4.4.3, Express to 5.2.1, and the complete Radix UI, Drizzle, Supabase, Axios,
Framer Motion, Recharts, and supporting dependency set to current stable
releases. The migrations follow the [React 19 upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide),
[Vite migration guide](https://vite.dev/guide/migration), [Tailwind CSS v4
upgrade guide](https://tailwindcss.com/docs/upgrade-guide), and [Zod v4 migration
guide](https://zod.dev/v4/changelog).

The UI wrapper layer was updated for [React DayPicker v10](https://daypicker.dev/upgrading),
[react-resizable-panels v4](https://github.com/bvaughn/react-resizable-panels/blob/main/CHANGELOG.md),
and [Recharts 3](https://github.com/recharts/recharts/wiki/3.0-migration-guide).
`better-sqlite3` intentionally remains on the verified 12.x line
(`^12.11.1`): version 13.x segfaults in this Node 20 sandbox. The required
`keyv@4.5.4` and `cacheable-request@7.0.4` security overrides remain exact.

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
# Requires a Windows native binary compatible with Electron 43 in node_modules/better-sqlite3/build/Release/
npm run build:electron
```
Output: `dist-electron/win-unpacked/` and `dist-electron/ExpenseTrack-<version>-Windows-x64.zip`

> **Note for cross-compilation:** Building on Linux requires a Windows prebuilt binary for the installed `better-sqlite3` and Electron versions. Download the matching asset from the [better-sqlite3 releases page](https://github.com/WiseLibs/better-sqlite3/releases) and extract `better_sqlite3.node` to `node_modules/better-sqlite3/build/Release/` before running electron-builder.

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

## Security note: pinned dependencies

`keyv` and `cacheable-request` are pinned to `4.5.4` and `7.0.4` respectively via
the `overrides` field in `package.json`. This is a deliberate protection against
the August 2026 Keyv/Cacheable npm supply chain attack, which compromised
`keyv@6.0.0`, `cacheable-request@13.0.20`, and 400+ other packages
(see the [Wiz writeup](https://www.wiz.io/blog/keyv-and-cacheable-npm-supply-chain-attack)).

These are transitive dependencies pulled in via `got` → `@electron/get` → `electron`.
**Before removing or updating these overrides**, verify that newer versions of
`keyv`/`cacheable-request` are confirmed clean against current npm security advisories.
