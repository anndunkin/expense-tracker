import type { Express } from "express";
import { Server } from "http";
import { storage } from "./storage";
import { insertExpenseReportSchema, insertExpenseItemSchema, updateExpenseItemSchema, insertCategorySchema } from "@shared/schema";
import { z } from "zod";

// Strip the X-Powered-By header globally — no need to advertise our stack
function applySecurityHeaders(app: Express) {
  app.disable("x-powered-by");
}

export async function registerRoutes(httpServer: Server, app: Express) {
  applySecurityHeaders(app);

  // ─── Require application/json for all mutating API requests ─────────────────
  // Returns 415 Unsupported Media Type if Content-Type is not application/json.
  // This catches form-urlencoded and other non-JSON bodies before they reach routes.
  app.use("/api", (req, res, next) => {
    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      const ct = req.headers["content-type"] || "";
      if (!ct.startsWith("application/json")) {
        return res.status(415).json({ error: "Content-Type must be application/json" });
      }
    }
    next();
  });

  // ─── Reports ────────────────────────────────────────────────────────────────
  app.get("/api/reports", (req, res) => {
    res.json(storage.getReports());
  });

  app.get("/api/reports/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const report = storage.getReport(id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    const items = storage.getItemsByReport(id);
    res.json({ report, items });
  });

  app.post("/api/reports", (req, res) => {
    const parsed = insertExpenseReportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    res.json(storage.createReport(parsed.data));
  });

  app.patch("/api/reports/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const updated = storage.updateReport(id, req.body);
    if (!updated) return res.status(404).json({ error: "Report not found" });
    res.json(updated);
  });

  app.delete("/api/reports/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const report = storage.getReport(id);
    if (!report) return res.status(404).json({ error: "Report not found" });
    storage.deleteReport(id);
    res.json({ ok: true });
  });

  // ─── Items ───────────────────────────────────────────────────────────────────
  app.get("/api/reports/:id/items", (req, res) => {
    res.json(storage.getItemsByReport(parseInt(req.params.id)));
  });

  app.post("/api/reports/:id/items", (req, res) => {
    const reportId = parseInt(req.params.id);
    // Verify the parent report exists before creating an orphaned item
    const report = storage.getReport(reportId);
    if (!report) return res.status(404).json({ error: "Report not found" });
    const parsed = insertExpenseItemSchema.safeParse({ ...req.body, reportId });
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    res.status(201).json(storage.createItem(parsed.data));
  });

  app.patch("/api/items/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const parsed = updateExpenseItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const updated = storage.updateItem(id, parsed.data);
    if (!updated) return res.status(404).json({ error: "Item not found" });
    res.json(updated);
  });

  app.delete("/api/items/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const item = storage.getItem(id);
    if (!item) return res.status(404).json({ error: "Item not found" });
    storage.deleteItem(id);
    res.json({ ok: true });
  });

  // ─── Categories ───────────────────────────────────────────────────────────────
  app.get("/api/categories/:type", (req, res) => {
    res.json(storage.getCategoriesByType(req.params.type));
  });

  app.post("/api/categories", (req, res) => {
    const parsed = insertCategorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    res.json(storage.createCategory(parsed.data));
  });

  app.patch("/api/categories/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const updated = storage.updateCategory(id, req.body);
    if (!updated) return res.status(404).json({ error: "Category not found" });
    res.json(updated);
  });

  app.delete("/api/categories/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const cat = storage.getCategory(id);
    if (!cat) return res.status(404).json({ error: "Category not found" });
    storage.deleteCategory(id);
    res.json({ ok: true });
  });

  // ─── Exchange rates ───────────────────────────────────────────────────────────
  app.get("/api/exchange-rate/:code", async (req, res) => {
    const code = req.params.code.toUpperCase();
    if (code === "USD") return res.json({ currencyCode: "USD", rateToUsd: 1 });

    // Check cache (1 hour TTL)
    const cached = storage.getExchangeRate(code);
    if (cached) {
      const ageMs = Date.now() - new Date(cached.updatedAt).getTime();
      if (ageMs < 3600000) return res.json(cached);
    }

    // Fetch from open exchange rates (free, no key needed for basic rates)
    try {
      const response = await fetch(`https://open.er-api.com/v6/latest/USD`);
      const data = await response.json() as any;
      if (data.rates && data.rates[code]) {
        const rateToUsd = 1 / data.rates[code];
        const saved = storage.upsertExchangeRate({
          currencyCode: code,
          rateToUsd,
          updatedAt: new Date().toISOString(),
        });
        return res.json(saved);
      }
      return res.status(404).json({ error: `Currency ${code} not found` });
    } catch (e) {
      if (cached) return res.json(cached);
      return res.status(503).json({ error: "Exchange rate service unavailable" });
    }
  });

  // ─── Bulk save (import/export a whole report) ─────────────────────────────
  app.post("/api/reports/import", (req, res) => {
    const { report, items } = req.body;
    const newReport = storage.createReport({
      name: report.name || "Imported Report",
      type: report.type,
      submitterName: report.submitterName || "",
      tripPurpose: report.tripPurpose || "",
      dateSubmitted: report.dateSubmitted || "",
      status: report.status || "draft",
    });
    const savedItems = [];
    if (Array.isArray(items)) {
      for (const item of items) {
        savedItems.push(storage.createItem({ ...item, id: undefined, reportId: newReport.id }));
      }
    }
    res.json({ report: newReport, items: savedItems });
  });


  // ─── App Settings ────────────────────────────────────────────────────────────
  app.get("/api/settings", (_req, res) => {
    res.json(storage.getSettings());
  });

  app.patch("/api/settings", (req, res) => {
    const patch = req.body as Record<string, string>;
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      return res.status(400).json({ error: "Body must be a JSON object of key/value strings" });
    }
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v !== "string") {
        return res.status(400).json({ error: `Value for key "${k}" must be a string` });
      }
    }
    res.json(storage.setSettings(patch));
  });

  // ─── Method Not Allowed catch-all for /api/* ────────────────────────────
  // Must be LAST — catches any method not explicitly registered above.
  // Prevents unregistered HTTP methods from falling through to the Vite
  // dev-server catch-all (which would return 200 for everything).
  app.all("/api/*path", (_req, res) => {
    res.status(405).json({ error: "Method not allowed" });
  });
}
