import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Expense Reports ────────────────────────────────────────────────────────
export const expenseReports = sqliteTable("expense_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default("Untitled Report"),
  type: text("type").notNull(), // "monthly" | "travel"
  submitterName: text("submitter_name").notNull().default(""),
  tripPurpose: text("trip_purpose").notNull().default(""),
  dateSubmitted: text("date_submitted").notNull().default(""),
  status: text("status").notNull().default("draft"), // "draft" | "complete"
  filePath: text("file_path").default(""), // last saved-to disk path (Electron only)
});

export const insertExpenseReportSchema = createInsertSchema(expenseReports).omit({ id: true });
export type InsertExpenseReport = z.infer<typeof insertExpenseReportSchema>;
export type ExpenseReport = typeof expenseReports.$inferSelect;

// ─── Expense Line Items ──────────────────────────────────────────────────────
export const expenseItems = sqliteTable("expense_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportId: integer("report_id").notNull(),
  date: text("date").notNull().default(""),
  purpose: text("purpose").notNull().default(""),
  category: text("category").notNull().default(""),
  amount: real("amount").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  amountUsd: real("amount_usd").notNull().default(0),
  exchangeRate: real("exchange_rate").notNull().default(1),
  // Mileage fields
  isMileage: integer("is_mileage", { mode: "boolean" }).notNull().default(false),
  miles: real("miles").notNull().default(0),
  // Travel only
  billedToCard: integer("billed_to_card", { mode: "boolean" }).notNull().default(false),
  notes: text("notes").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

// Supported currencies — must match the CURRENCIES list in the frontend
const SUPPORTED_CURRENCIES = [
  "USD", "EUR", "GBP", "CAD", "MXN", "JPY", "AUD", "CHF", "CNY", "INR",
  "BRL", "KRW", "SGD", "HKD", "NZD", "SEK", "NOK", "DKK", "ZAR", "AED",
] as const;

export const insertExpenseItemSchema = createInsertSchema(expenseItems)
  .omit({ id: true })
  .extend({
    // amount: must be a finite, non-negative number
    amount: z.number().finite().nonnegative({ message: "Amount must be 0 or greater" }),
    // amountUsd: must be a finite, non-negative number (converted value used in totals)
    amountUsd: z.number().finite().nonnegative({ message: "USD amount must be 0 or greater" }),
    // exchangeRate: must be a positive, finite number (never 0 — would corrupt division)
    exchangeRate: z.number().finite().positive({ message: "Exchange rate must be greater than 0" }),
    // miles: optional (defaults to 0 for non-mileage items); validated > 0 for mileage in superRefine
    miles: z.number().finite().nonnegative({ message: "Miles must be 0 or greater" }).optional().default(0),
    // currency: must be one of the supported codes
    currency: z.enum(SUPPORTED_CURRENCIES, {
      errorMap: () => ({ message: `Currency must be one of: ${SUPPORTED_CURRENCIES.join(", ")}` }),
    }),
  })
  .superRefine((data, ctx) => {
    // When isMileage is true, miles must be > 0
    if (data.isMileage && (data.miles === undefined || data.miles <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["miles"],
        message: "Miles must be greater than 0 for mileage items",
      });
    }
  });

// Base schema without superRefine — used to derive the partial PATCH schema
const baseExpenseItemSchema = createInsertSchema(expenseItems)
  .omit({ id: true })
  .extend({
    amount: z.number().finite().nonnegative({ message: "Amount must be 0 or greater" }),
    amountUsd: z.number().finite().nonnegative({ message: "USD amount must be 0 or greater" }),
    exchangeRate: z.number().finite().positive({ message: "Exchange rate must be greater than 0" }),
    miles: z.number().finite().nonnegative({ message: "Miles must be 0 or greater" }).optional().default(0),
    currency: z.enum(SUPPORTED_CURRENCIES, {
      errorMap: () => ({ message: `Currency must be one of: ${SUPPORTED_CURRENCIES.join(", ")}` }),
    }),
  });

// Partial schema for PATCH — same field rules but all fields optional, no cross-field checks needed
export const updateExpenseItemSchema = baseExpenseItemSchema.partial().omit({ reportId: true });

export type InsertExpenseItem = z.infer<typeof insertExpenseItemSchema>;
export type ExpenseItem = typeof expenseItems.$inferSelect;

// ─── Custom Categories ───────────────────────────────────────────────────────
export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reportType: text("report_type").notNull(), // "monthly" | "travel"
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
});

export const insertCategorySchema = createInsertSchema(categories).omit({ id: true });
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;

// ─── App Settings (key/value store) ────────────────────────────────────────
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type AppSetting = typeof appSettings.$inferSelect;

// Well-known setting keys
export const SETTINGS_KEYS = {
  MONTHLY_HEADER: "monthlyReportHeader",
  TRAVEL_HEADER: "travelReportHeader",
  DEFAULT_SAVE_LOCATION: "defaultSaveLocation",
} as const;

export const DEFAULT_SETTINGS: Record<string, string> = {
  [SETTINGS_KEYS.MONTHLY_HEADER]: "Monthly Expense Report",
  [SETTINGS_KEYS.TRAVEL_HEADER]: "Travel Expense Report",
  [SETTINGS_KEYS.DEFAULT_SAVE_LOCATION]: "", // empty = use OS default Documents folder
};

// ─── Exchange Rate Cache ─────────────────────────────────────────────────────
export const exchangeRates = sqliteTable("exchange_rates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  currencyCode: text("currency_code").notNull(),
  rateToUsd: real("rate_to_usd").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertExchangeRateSchema = createInsertSchema(exchangeRates).omit({ id: true });
export type InsertExchangeRate = z.infer<typeof insertExchangeRateSchema>;
export type ExchangeRate = typeof exchangeRates.$inferSelect;
