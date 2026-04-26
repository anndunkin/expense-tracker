import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and } from "drizzle-orm";
import path from "path";
import fs from "fs";
import {
  expenseReports, expenseItems, categories, exchangeRates, appSettings,
  type ExpenseReport, type InsertExpenseReport,
  type ExpenseItem, type InsertExpenseItem,
  type Category, type InsertCategory,
  type ExchangeRate, type InsertExchangeRate,
  type AppSetting, DEFAULT_SETTINGS,
} from "@shared/schema";

// DATA_DIR is set by Electron main process to %APPDATA%/ExpenseTrack
const dataDir = process.env.DATA_DIR || process.cwd();
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "data.db");

// BETTER_SQLITE3_BINDING lets Electron point directly to the .node file
// without needing the full node_modules/better-sqlite3 tree on disk.
const dbOptions = process.env.BETTER_SQLITE3_BINDING
  ? { nativeBinding: process.env.BETTER_SQLITE3_BINDING }
  : {};
const sqlite = new Database(dbPath, dbOptions);
console.log("[db] using", dbPath);
const db = drizzle(sqlite);

// ─── Run migrations inline ───────────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS expense_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'Untitled Report',
    type TEXT NOT NULL,
    submitter_name TEXT NOT NULL DEFAULT '',
    trip_purpose TEXT NOT NULL DEFAULT '',
    date_submitted TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft'
  );

  CREATE TABLE IF NOT EXISTS expense_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    date TEXT NOT NULL DEFAULT '',
    purpose TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    amount_usd REAL NOT NULL DEFAULT 0,
    exchange_rate REAL NOT NULL DEFAULT 1,
    is_mileage INTEGER NOT NULL DEFAULT 0,
    miles REAL NOT NULL DEFAULT 0,
    billed_to_card INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_type TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS exchange_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    currency_code TEXT NOT NULL,
    rate_to_usd REAL NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Seed default categories if none exist
const existingCats = db.select().from(categories).all();
if (existingCats.length === 0) {
  const monthlyDefaults = [
    "Equipment", "Supplies", "Rental Cars", "Gas", "Public Transportation",
    "Meals", "Meeting Registration", "Software & Subscriptions",
    "Mileage Reimbursement", "Miscellaneous"
  ];
  const travelDefaults = [
    "Airfare", "Public Transportation", "Rental Car", "Gas", "Meals",
    "Meeting Registration", "Supplies", "Mileage Reimbursement", "Miscellaneous"
  ];

  for (let i = 0; i < monthlyDefaults.length; i++) {
    db.insert(categories).values({ reportType: "monthly", name: monthlyDefaults[i], sortOrder: i, isDefault: true }).run();
  }
  for (let i = 0; i < travelDefaults.length; i++) {
    db.insert(categories).values({ reportType: "travel", name: travelDefaults[i], sortOrder: i, isDefault: true }).run();
  }
}

export interface IStorage {
  // Reports
  getReports(): ExpenseReport[];
  getReport(id: number): ExpenseReport | undefined;
  createReport(data: InsertExpenseReport): ExpenseReport;
  updateReport(id: number, data: Partial<InsertExpenseReport>): ExpenseReport | undefined;
  deleteReport(id: number): void;

  // Items
  getItemsByReport(reportId: number): ExpenseItem[];
  getItem(id: number): ExpenseItem | undefined;
  createItem(data: InsertExpenseItem): ExpenseItem;
  updateItem(id: number, data: Partial<InsertExpenseItem>): ExpenseItem | undefined;
  deleteItem(id: number): void;
  deleteItemsByReport(reportId: number): void;

  // Categories
  getCategoriesByType(reportType: string): Category[];
  getCategory(id: number): Category | undefined;
  createCategory(data: InsertCategory): Category;
  updateCategory(id: number, data: Partial<InsertCategory>): Category | undefined;
  deleteCategory(id: number): void;

  // Exchange rates
  getExchangeRate(code: string): ExchangeRate | undefined;
  upsertExchangeRate(data: InsertExchangeRate): ExchangeRate;

  // App settings
  getSettings(): Record<string, string>;
  getSetting(key: string): string;
  setSetting(key: string, value: string): AppSetting;
  setSettings(patch: Record<string, string>): Record<string, string>;
}

class SQLiteStorage implements IStorage {
  // Reports
  getReports() {
    return db.select().from(expenseReports).all();
  }
  getReport(id: number) {
    return db.select().from(expenseReports).where(eq(expenseReports.id, id)).get();
  }
  createReport(data: InsertExpenseReport) {
    return db.insert(expenseReports).values(data).returning().get();
  }
  updateReport(id: number, data: Partial<InsertExpenseReport>) {
    return db.update(expenseReports).set(data).where(eq(expenseReports.id, id)).returning().get();
  }
  deleteReport(id: number) {
    db.delete(expenseItems).where(eq(expenseItems.reportId, id)).run();
    db.delete(expenseReports).where(eq(expenseReports.id, id)).run();
  }

  // Items
  getItemsByReport(reportId: number) {
    return db.select().from(expenseItems).where(eq(expenseItems.reportId, reportId)).all();
  }
  getItem(id: number) {
    return db.select().from(expenseItems).where(eq(expenseItems.id, id)).get();
  }
  createItem(data: InsertExpenseItem) {
    return db.insert(expenseItems).values(data).returning().get();
  }
  updateItem(id: number, data: Partial<InsertExpenseItem>) {
    return db.update(expenseItems).set(data).where(eq(expenseItems.id, id)).returning().get();
  }
  deleteItem(id: number) {
    db.delete(expenseItems).where(eq(expenseItems.id, id)).run();
  }
  deleteItemsByReport(reportId: number) {
    db.delete(expenseItems).where(eq(expenseItems.reportId, reportId)).run();
  }

  // Categories
  getCategoriesByType(reportType: string) {
    return db.select().from(categories).where(eq(categories.reportType, reportType)).all();
  }
  getCategory(id: number) {
    return db.select().from(categories).where(eq(categories.id, id)).get();
  }
  createCategory(data: InsertCategory) {
    return db.insert(categories).values(data).returning().get();
  }
  updateCategory(id: number, data: Partial<InsertCategory>) {
    return db.update(categories).set(data).where(eq(categories.id, id)).returning().get();
  }
  deleteCategory(id: number) {
    db.delete(categories).where(eq(categories.id, id)).run();
  }

  // Exchange rates
  getExchangeRate(code: string) {
    return db.select().from(exchangeRates).where(eq(exchangeRates.currencyCode, code)).get();
  }
  upsertExchangeRate(data: InsertExchangeRate) {
    const existing = this.getExchangeRate(data.currencyCode);
    if (existing) {
      return db.update(exchangeRates).set(data).where(eq(exchangeRates.currencyCode, data.currencyCode)).returning().get()!;
    }
    return db.insert(exchangeRates).values(data).returning().get();
  }

  // App settings
  getSettings(): Record<string, string> {
    const rows = db.select().from(appSettings).all();
    const result: Record<string, string> = { ...DEFAULT_SETTINGS };
    for (const row of rows) result[row.key] = row.value;
    return result;
  }
  getSetting(key: string): string {
    const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
    return row?.value ?? DEFAULT_SETTINGS[key] ?? "";
  }
  setSetting(key: string, value: string): AppSetting {
    const existing = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
    if (existing) {
      return db.update(appSettings).set({ value }).where(eq(appSettings.key, key)).returning().get()!;
    }
    return db.insert(appSettings).values({ key, value }).returning().get();
  }
  setSettings(patch: Record<string, string>): Record<string, string> {
    for (const [key, value] of Object.entries(patch)) {
      this.setSetting(key, value);
    }
    return this.getSettings();
  }
}

export const storage = new SQLiteStorage();
