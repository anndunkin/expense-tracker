import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/ThemeProvider";
import CategoryManagerDialog from "@/components/CategoryManagerDialog";
import type { ExpenseReport, ExpenseItem, Category } from "@shared/schema";
import {
  ArrowLeft, Plus, Trash2, Save, FileDown, Printer, FolderOpen,
  Moon, Sun, Receipt, Plane, Calendar, Settings2, DollarSign,
  AlertCircle, FilePlus
} from "lucide-react";

const MILEAGE_RATE = 0.725; // 2026 IRS rate
const MEAL_DEDUCTION_RATE = 0.5;

// Common currencies
const CURRENCIES = [
  "USD", "EUR", "GBP", "CAD", "MXN", "JPY", "AUD", "CHF", "CNY", "INR",
  "BRL", "KRW", "SGD", "HKD", "NZD", "SEK", "NOK", "DKK", "ZAR", "AED"
];

interface ItemRow extends Partial<ExpenseItem> {
  _tempId?: string;
  _dirty?: boolean;
}

export default function ReportEditorPage() {
  const params = useParams<{ id?: string; type?: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { theme, toggle } = useTheme();

  // Derive type from params or from current URL hash
  const deriveType = (): "monthly" | "travel" => {
    if (params.type === "travel" || params.type === "monthly") return params.type;
    const h = typeof window !== "undefined" ? window.location.hash : "";
    if (h.includes("/report/new/travel")) return "travel";
    return "monthly";
  };
  const isNew = !params.id || params.id === "new" || isNaN(parseInt(params.id ?? ""));
  const reportId = !isNew ? parseInt(params.id!) : null;

  const [reportMeta, setReportMeta] = useState<Partial<ExpenseReport>>(() => ({
    type: deriveType(),
    name: "",
    submitterName: "",
    tripPurpose: "",
    dateSubmitted: "",  // stays blank until status → complete
    status: "draft",
  }));
  const [items, setItems] = useState<ItemRow[]>([]);
  const [savedReportId, setSavedReportId] = useState<number | null>(reportId);
  const [showCategoryMgr, setShowCategoryMgr] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [saveAsWorking, setSaveAsWorking] = useState(false);
  const [exchangeRateCache, setExchangeRateCache] = useState<Record<string, number>>({ USD: 1 });
  const [fetchingRates, setFetchingRates] = useState<Record<string, boolean>>({});

  // Load existing report
  const { data: existingData } = useQuery<{ report: ExpenseReport; items: ExpenseItem[] }>({
    queryKey: ["/api/reports", reportId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/${reportId}`);
      return res.json();
    },
    enabled: !!reportId,
  });

  useEffect(() => {
    if (existingData) {
      setReportMeta(existingData.report);
      setItems(existingData.items.map(i => ({ ...i, _dirty: false })));
    }
  }, [existingData]);

  // Categories
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories", reportMeta.type],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/categories/${reportMeta.type}`);
      return res.json();
    },
    enabled: !!reportMeta.type,
  });

  const categoryNames = categories.map(c => c.name);

  // Exchange rate fetch
  const fetchRate = useCallback(async (code: string) => {
    if (code === "USD" || exchangeRateCache[code] !== undefined || fetchingRates[code]) return;
    setFetchingRates(f => ({ ...f, [code]: true }));
    try {
      const res = await apiRequest("GET", `/api/exchange-rate/${code}`);
      const data = await res.json();
      if (data.rateToUsd) {
        setExchangeRateCache(c => ({ ...c, [code]: data.rateToUsd }));
      }
    } catch {
      toast({ title: `Could not fetch rate for ${code}`, variant: "destructive" });
    } finally {
      setFetchingRates(f => ({ ...f, [code]: false }));
    }
  }, [exchangeRateCache, fetchingRates]);

  // Save report
  const createReport = useMutation({
    mutationFn: async (meta: Partial<ExpenseReport>) => {
      const res = await apiRequest("POST", "/api/reports", meta);
      return res.json() as Promise<ExpenseReport>;
    },
  });

  const updateReport = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<ExpenseReport> }) => {
      const res = await apiRequest("PATCH", `/api/reports/${id}`, data);
      return res.json() as Promise<ExpenseReport>;
    },
  });

  const saveItems = async (rid: number, itemList: ItemRow[]) => {
    for (const item of itemList) {
      if (item.id) {
        await apiRequest("PATCH", `/api/items/${item.id}`, { ...item, reportId: rid });
      } else {
        await apiRequest("POST", `/api/reports/${rid}/items`, { ...item, reportId: rid });
      }
    }
  };

  const handleSave = async (name?: string) => {
    const saveName = name || reportMeta.name || "Untitled Report";
    try {
      let rid = savedReportId;
      if (!rid) {
        const created = await createReport.mutateAsync({ ...reportMeta, name: saveName });
        rid = created.id;
        setSavedReportId(rid);
        setReportMeta(m => ({ ...m, id: rid!, name: saveName }));
        navigate(`/report/${rid}`, { replace: true });
      } else {
        await updateReport.mutateAsync({ id: rid, data: { ...reportMeta, name: saveName } });
      }
      await saveItems(rid, items);
      // Reload items to get IDs
      const res = await apiRequest("GET", `/api/reports/${rid}/items`);
      const savedItems = await res.json();
      setItems(savedItems.map((i: ExpenseItem) => ({ ...i, _dirty: false })));
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      toast({ title: "Report saved", description: saveName });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  // Open the Save As dialog — pre-fill with current report name
  const openSaveAs = () => {
    setSaveAsName(reportMeta.name || "Untitled Report");
    setShowSaveAs(true);
  };

  const commitSaveAs = async () => {
    const name = saveAsName.trim();
    if (!name) return;
    setSaveAsWorking(true);
    try {
      // Always POST a brand-new report — never overwrite the current one
      const { id: _rid, ...metaWithoutId } = reportMeta as any;
      const created = await createReport.mutateAsync({ ...metaWithoutId, name });
      const newId = created.id;

      // Copy all current items — strip ids and _tempId so the server assigns fresh ones
      const itemsToCopy = items.map(({ id: _id, _tempId: _t, reportId: _r, ...rest }) => rest);
      await saveItems(newId, itemsToCopy);

      // Reload items to get their new server-assigned ids
      const res = await apiRequest("GET", `/api/reports/${newId}/items`);
      const savedItems = await res.json();

      // Switch the editor to the new report
      setSavedReportId(newId);
      setReportMeta(m => ({ ...m, id: newId, name }));
      setItems(savedItems.map((i: ExpenseItem) => ({ ...i, _dirty: false })));
      setShowSaveAs(false);
      navigate(`/report/${newId}`, { replace: true });
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      toast({ title: "Saved as new report", description: name });
    } catch {
      toast({ title: "Save As failed", variant: "destructive" });
    } finally {
      setSaveAsWorking(false);
    }
  };

  const handleExportFile = async () => {
    if (!savedReportId) {
      await handleSave();
    }
    const exportData = { report: reportMeta, items };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(reportMeta.name || "expense-report").replace(/[^a-z0-9]/gi, "-").toLowerCase()}.expense`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".expense,.json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const res = await apiRequest("POST", "/api/reports/import", data);
        const imported = await res.json();
        queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
        navigate(`/report/${imported.report.id}`);
      } catch {
        toast({ title: "Error opening file", variant: "destructive" });
      }
    };
    input.click();
  };

  // Item CRUD
  const addItem = () => {
    const newItem: ItemRow = {
      _tempId: `tmp_${Date.now()}`,
      reportId: savedReportId || undefined,
      date: new Date().toISOString().split("T")[0],
      purpose: "",
      category: categoryNames[0] || "",
      amount: 0,
      currency: "USD",
      amountUsd: 0,
      exchangeRate: 1,
      isMileage: false,
      miles: 0,
      billedToCard: false,
      notes: "",
      sortOrder: items.length,
      _dirty: true,
    };
    setItems(prev => [...prev, newItem]);
  };

  const removeItem = async (item: ItemRow) => {
    if (item.id) {
      await apiRequest("DELETE", `/api/items/${item.id}`);
    }
    // Keep every item that is NOT the one being removed.
    // Use a stable unique key: prefer db id, fall back to _tempId.
    setItems(prev => prev.filter(i => {
      if (item.id && i.id) return i.id !== item.id;
      if (item._tempId && i._tempId) return i._tempId !== item._tempId;
      return true; // shouldn't happen, but never accidentally delete
    }));
  };

  const updateItem = (idx: number, patch: Partial<ItemRow>) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, ...patch, _dirty: true };
      // Recalculate USD
      if ("isMileage" in patch || "miles" in patch) {
        const miles = patch.miles ?? updated.miles ?? 0;
        if (patch.isMileage || updated.isMileage) {
          updated.amountUsd = miles * MILEAGE_RATE;
          updated.amount = updated.amountUsd;
          updated.currency = "USD";
          updated.exchangeRate = 1;
        }
      }
      if ("currency" in patch && patch.currency && !updated.isMileage) {
        fetchRate(patch.currency);
        const rate = exchangeRateCache[patch.currency] ?? 1;
        updated.amountUsd = (updated.amount ?? 0) * rate;
        updated.exchangeRate = rate;
      }
      if ("amount" in patch && !updated.isMileage) {
        const rate = exchangeRateCache[updated.currency ?? "USD"] ?? 1;
        updated.amountUsd = (patch.amount ?? 0) * rate;
        updated.exchangeRate = rate;
      }
      return updated;
    }));
  };

  // Effect: re-calc USD when exchange rate fetched
  useEffect(() => {
    setItems(prev => prev.map(item => {
      if (!item.currency || item.currency === "USD" || item.isMileage) return item;
      const rate = exchangeRateCache[item.currency];
      if (!rate) return item;
      return { ...item, amountUsd: (item.amount ?? 0) * rate, exchangeRate: rate };
    }));
  }, [exchangeRateCache]);

  // Totals
  const reimbursableItems = items.filter(i => !i.billedToCard);
  const cardItems = items.filter(i => i.billedToCard);
  const totalReimbursable = reimbursableItems.reduce((s, i) => s + (i.amountUsd ?? 0), 0);
  const totalCard = cardItems.reduce((s, i) => s + (i.amountUsd ?? 0), 0);
  const totalAll = items.reduce((s, i) => s + (i.amountUsd ?? 0), 0);

  // Tax deductible: all items except meals are 100%, meals are 50%
  const taxDeductible = items.reduce((s, i) => {
    const amt = i.billedToCard ? 0 : (i.amountUsd ?? 0); // only reimbursable are deductible
    return s + (i.category?.toLowerCase() === "meals" ? amt * MEAL_DEDUCTION_RATE : amt);
  }, 0);

  const rType = reportMeta.type as "monthly" | "travel";

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-2 flex-wrap">
          <button
            onClick={() => navigate("/")}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className={`w-7 h-7 rounded flex items-center justify-center flex-shrink-0 ${
              rType === "travel" ? "bg-blue-100 dark:bg-blue-900/40" : "bg-green-100 dark:bg-green-900/40"
            }`}>
              {rType === "travel"
                ? <Plane className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                : <Calendar className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
              }
            </div>
            <input
              className="text-sm font-medium bg-transparent border-none outline-none text-foreground min-w-0 flex-1 truncate"
              value={reportMeta.name ?? ""}
              onChange={e => setReportMeta(m => ({ ...m, name: e.target.value }))}
              placeholder="Report name..."
              data-testid="input-report-name"
            />
            <Badge variant="secondary" className="text-xs flex-shrink-0 capitalize">{rType}</Badge>
          </div>

          {/* File menu */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => navigate("/")} data-testid="button-new-report">
              <FilePlus className="w-3.5 h-3.5" />New
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={handleOpenFile} data-testid="button-file-open">
              <FolderOpen className="w-3.5 h-3.5" />Open
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => handleSave()} data-testid="button-file-save">
              <Save className="w-3.5 h-3.5" />Save
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={openSaveAs} data-testid="button-file-saveas">
              <Save className="w-3.5 h-3.5" />Save As…
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={handleExportFile} data-testid="button-file-export">
              <FileDown className="w-3.5 h-3.5" />Export
            </Button>
            {savedReportId && (
              <Button size="sm" variant="default" className="gap-1.5 h-8 text-xs" onClick={() => navigate(`/report/${savedReportId}/print`)} data-testid="button-print">
                <Printer className="w-3.5 h-3.5" />Print
              </Button>
            )}
            <button onClick={toggle} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" data-testid="button-theme">
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Report metadata */}
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Receipt className="w-4 h-4" /> Report Details
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="submitter-name">Requestor Name</Label>
              <Input
                id="submitter-name"
                value={reportMeta.submitterName ?? ""}
                onChange={e => setReportMeta(m => ({ ...m, submitterName: e.target.value }))}
                placeholder="Full name"
                data-testid="input-submitter-name"
              />
            </div>
            <div>
              <Label htmlFor="trip-purpose">Trip / Purpose</Label>
              <Input
                id="trip-purpose"
                value={reportMeta.tripPurpose ?? ""}
                onChange={e => setReportMeta(m => ({ ...m, tripPurpose: e.target.value }))}
                placeholder="Purpose of expense"
                data-testid="input-trip-purpose"
              />
            </div>
            <div>
              <Label htmlFor="date-submitted">Date Submitted</Label>
              {reportMeta.dateSubmitted ? (
                <Input
                  id="date-submitted"
                  type="date"
                  value={reportMeta.dateSubmitted}
                  onChange={e => setReportMeta(m => ({ ...m, dateSubmitted: e.target.value }))}
                  data-testid="input-date-submitted"
                />
              ) : (
                <div
                  id="date-submitted"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground items-center"
                  data-testid="input-date-submitted"
                >
                  Auto-filled on Complete
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select
                value={reportMeta.status ?? "draft"}
                onValueChange={v => setReportMeta(m => ({
                  ...m,
                  status: v,
                  // Auto-fill date submitted when marked complete; clear it if reverted to draft
                  dateSubmitted: v === "complete"
                    ? (m.dateSubmitted || new Date().toISOString().split("T")[0])
                    : (v === "draft" ? "" : m.dateSubmitted),
                }))}
              >
                <SelectTrigger id="status" data-testid="select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        {/* Expense items */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <DollarSign className="w-4 h-4" /> Expense Items
            </h2>
            <div className="flex gap-2">
              <Button
                size="sm" variant="outline"
                className="gap-1.5 h-8 text-xs"
                onClick={() => setShowCategoryMgr(true)}
                data-testid="button-manage-categories"
              >
                <Settings2 className="w-3.5 h-3.5" /> Categories
              </Button>
              <Button
                size="sm"
                className="gap-1.5 h-8 text-xs"
                onClick={addItem}
                data-testid="button-add-item"
              >
                <Plus className="w-3.5 h-3.5" /> Add Item
              </Button>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="border border-dashed border-border rounded-lg p-8 text-center">
              <p className="text-muted-foreground text-sm">No items yet. Click "Add Item" to begin.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Column headers */}
              <div className={`grid gap-2 px-3 text-xs font-medium text-muted-foreground ${
                rType === "travel"
                  ? "grid-cols-[148px_1fr_150px_80px_110px_100px_80px_32px]"
                  : "grid-cols-[148px_1fr_150px_80px_110px_100px_32px]"
              }`}>
                <span>Date</span>
                <span>Purpose</span>
                <span>Category</span>
                <span>Currency</span>
                <span>Amount</span>
                <span className="text-right">USD</span>
                {rType === "travel" && <span className="text-center">Corp Card</span>}
                <span></span>
              </div>

              {items.map((item, idx) => (
                <ItemRowComponent
                  key={item.id ?? item._tempId}
                  item={item}
                  idx={idx}
                  rType={rType}
                  categoryNames={categoryNames}
                  onUpdate={(patch) => updateItem(idx, patch)}
                  onRemove={() => removeItem(item)}
                  onCurrencyChange={(code) => fetchRate(code)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Totals */}
        {items.length > 0 && (
          <Card className="p-6">
            <h2 className="text-sm font-semibold text-foreground mb-4">Summary</h2>
            <div className="space-y-2 max-w-xs ml-auto">
              {/* Always show reimbursable sub-line */}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Reimbursable expenses</span>
                <span className="font-medium">${totalReimbursable.toFixed(2)}</span>
              </div>
              {/* Corporate card line — travel only, when there are card items */}
              {rType === "travel" && cardItems.length > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Billed to corporate card</span>
                  <span className="font-medium">${totalCard.toFixed(2)}</span>
                </div>
              )}
              <Separator />
              {/* Total expenses = all items */}
              <div className="flex justify-between text-sm font-semibold">
                <span>Total expenses</span>
                <span>${totalAll.toFixed(2)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  Tax deductible
                  <span className="text-xs">(meals at 50%)</span>
                </span>
                <span className="font-medium text-green-600 dark:text-green-400">${taxDeductible.toFixed(2)}</span>
              </div>
              <div className="mt-3 pt-3 border-t border-border">
                <div className="flex justify-between text-base font-bold">
                  <span>Total Reimbursement Due</span>
                  <span className="text-primary">${totalReimbursable.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Mileage note */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            Mileage reimbursed at the 2026 IRS standard rate of <strong>72.5¢ per mile</strong>.
            Meals are tax deductible at 50% per IRS guidelines.
          </span>
        </div>
      </main>

      <CategoryManagerDialog
        open={showCategoryMgr}
        onOpenChange={setShowCategoryMgr}
        reportType={rType}
      />

      {/* Save As dialog — uses a proper modal instead of window.prompt (blocked in Electron) */}
      <Dialog open={showSaveAs} onOpenChange={setShowSaveAs}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save As New Report</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="save-as-name">Report name</Label>
            <Input
              id="save-as-name"
              value={saveAsName}
              onChange={e => setSaveAsName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") commitSaveAs(); }}
              autoFocus
              className="mt-1"
              data-testid="input-save-as-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveAs(false)} disabled={saveAsWorking}>Cancel</Button>
            <Button onClick={commitSaveAs} disabled={!saveAsName.trim() || saveAsWorking}>
              {saveAsWorking ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Item Row Component ───────────────────────────────────────────────────────
function ItemRowComponent({
  item, idx, rType, categoryNames, onUpdate, onRemove, onCurrencyChange
}: {
  item: ItemRow;
  idx: number;
  rType: "monthly" | "travel";
  categoryNames: string[];
  onUpdate: (patch: Partial<ItemRow>) => void;
  onRemove: () => void;
  onCurrencyChange: (code: string) => void;
}) {
  const isMileage = item.category === "Mileage Reimbursement";
  const dateInputRef = useRef<HTMLInputElement>(null);

  // Auto-switch isMileage when category changes
  const handleCategoryChange = (val: string) => {
    onUpdate({ category: val, isMileage: val === "Mileage Reimbursement" });
  };

  const openDatePicker = () => {
    try { dateInputRef.current?.showPicker(); } catch { dateInputRef.current?.focus(); }
  };

  return (
    <div className={`grid gap-2 items-start p-3 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors ${
      item.billedToCard ? "opacity-75 bg-blue-50/50 dark:bg-blue-950/20" : ""
    } ${
      rType === "travel"
        ? "grid-cols-[148px_1fr_150px_80px_110px_100px_80px_32px]"
        : "grid-cols-[148px_1fr_150px_80px_110px_100px_32px]"
    }`} data-testid={`row-item-${idx}`}>
      {/* Date / Prepaid — travel reports can mark an item as prepaid instead of choosing a date */}
      {rType === "travel" ? (
        <div className="flex flex-col gap-1">
          {item.date === "prepaid" ? (
            <div
              className="h-8 flex items-center justify-center rounded-md border border-blue-400 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-xs font-medium cursor-pointer select-none"
              onClick={() => onUpdate({ date: new Date().toISOString().split("T")[0] })}
              title="Click to enter a date instead"
              data-testid={`input-date-${idx}`}
            >
              Prepaid
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <input
                ref={dateInputRef}
                type="date"
                value={item.date ?? ""}
                onChange={e => onUpdate({ date: e.target.value })}
                className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-0"
                data-testid={`input-date-${idx}`}
              />
              <button
                type="button"
                onClick={openDatePicker}
                className="h-8 w-8 flex items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
                title="Pick a date"
                tabIndex={-1}
                data-testid={`button-date-picker-${idx}`}
              >
                <Calendar className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <label className="flex items-center gap-1 cursor-pointer select-none" title="Mark as prepaid — no reimbursement date needed">
            <Checkbox
              checked={item.date === "prepaid"}
              onCheckedChange={checked => onUpdate({ date: checked ? "prepaid" : new Date().toISOString().split("T")[0] })}
              className="h-3 w-3"
              data-testid={`checkbox-prepaid-${idx}`}
            />
            <span className="text-[10px] text-muted-foreground leading-none">Prepaid</span>
          </label>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <input
            ref={dateInputRef}
            type="date"
            value={item.date ?? ""}
            onChange={e => onUpdate({ date: e.target.value })}
            className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-0"
            data-testid={`input-date-${idx}`}
          />
          <button
            type="button"
            onClick={openDatePicker}
            className="h-8 w-8 flex items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
            title="Pick a date"
            tabIndex={-1}
            data-testid={`button-date-picker-${idx}`}
          >
            <Calendar className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <Input
        value={item.purpose ?? ""}
        onChange={e => onUpdate({ purpose: e.target.value })}
        placeholder="Description"
        className="h-8 text-xs"
        data-testid={`input-purpose-${idx}`}
      />
      <Select value={item.category ?? ""} onValueChange={handleCategoryChange}>
        <SelectTrigger className="h-8 text-xs [&>span]:text-left [&>span]:truncate" data-testid={`select-category-${idx}`}>
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          {categoryNames.map(name => (
            <SelectItem key={name} value={name} className="text-xs">{name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Currency */}
      {isMileage ? (
        <div className="h-8 flex items-center justify-center text-xs text-muted-foreground bg-muted rounded-md px-2">
          miles
        </div>
      ) : (
        <Select value={item.currency ?? "USD"} onValueChange={v => { onUpdate({ currency: v }); onCurrencyChange(v); }}>
          <SelectTrigger className="h-8 text-xs [&>span]:text-left" data-testid={`select-currency-${idx}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map(c => (
              <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Amount / Miles — string-controlled so the zero is cleared on focus */}
      <div>
        <Input
          type="number"
          min={0}
          step={isMileage ? 1 : 0.01}
          value={isMileage ? (item.miles ?? 0) : (item.amount ?? 0)}
          onFocus={e => e.target.select()}
          onChange={e => {
            const raw = e.target.value;
            const val = raw === "" ? 0 : parseFloat(raw);
            if (isNaN(val)) return;
            if (isMileage) {
              onUpdate({ miles: val, amountUsd: val * 0.725, amount: val * 0.725 });
            } else {
              onUpdate({ amount: val });
            }
          }}
          className="h-8 text-xs"
          placeholder={isMileage ? "Miles" : "Amount"}
          data-testid={`input-amount-${idx}`}
        />
        {isMileage && item.miles ? (
          <p className="text-xs text-muted-foreground mt-0.5 px-1">
            = ${(item.miles * 0.725).toFixed(2)}
          </p>
        ) : null}
      </div>

      {/* USD Amount */}
      <div className="h-8 flex items-center justify-end pr-1">
        {item.currency !== "USD" && !isMileage && item.currency ? (
          <div className="text-right">
            <span className="text-xs font-medium">${(item.amountUsd ?? 0).toFixed(2)}</span>
            <p className="text-xs text-muted-foreground leading-none mt-0.5">
              {item.currency} {(item.amount ?? 0).toFixed(2)}
            </p>
          </div>
        ) : (
          <span className="text-xs font-medium">${(item.amountUsd ?? 0).toFixed(2)}</span>
        )}
      </div>

      {/* Corporate card (travel only) */}
      {rType === "travel" && (
        <div className="h-8 flex items-center justify-center">
          <Checkbox
            checked={item.billedToCard ?? false}
            onCheckedChange={v => onUpdate({ billedToCard: !!v })}
            data-testid={`checkbox-card-${idx}`}
          />
        </div>
      )}

      <button
        onClick={onRemove}
        className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        data-testid={`button-remove-item-${idx}`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
