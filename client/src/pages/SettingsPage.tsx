import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/ThemeProvider";
import type { Category } from "@shared/schema";
import { SETTINGS_KEYS } from "@shared/schema";
import {
  ArrowLeft, Moon, Sun, Plus, Trash2, GripVertical,
  Receipt, Plane, Settings2, Type,
} from "lucide-react";

export default function SettingsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { theme, toggle } = useTheme();

  // ─── Report header settings ────────────────────────────────────────────────
  const { data: settings = {} as Record<string, string> } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/settings");
      return res.json();
    },
  });

  const [monthlyHeader, setMonthlyHeader] = useState("");
  const [travelHeader, setTravelHeader] = useState("");
  const [headersDirty, setHeadersDirty] = useState(false);

  // Seed state from server data once loaded
  useEffect(() => {
    if (settings[SETTINGS_KEYS.MONTHLY_HEADER] !== undefined) {
      setMonthlyHeader(settings[SETTINGS_KEYS.MONTHLY_HEADER]);
    }
    if (settings[SETTINGS_KEYS.TRAVEL_HEADER] !== undefined) {
      setTravelHeader(settings[SETTINGS_KEYS.TRAVEL_HEADER]);
    }
  }, [settings]);

  const saveHeadersMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/settings", {
        [SETTINGS_KEYS.MONTHLY_HEADER]: monthlyHeader.trim() || "Monthly Expense Report",
        [SETTINGS_KEYS.TRAVEL_HEADER]: travelHeader.trim() || "Travel Expense Report",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setHeadersDirty(false);
      toast({ title: "Report headers saved" });
    },
    onError: () => toast({ title: "Failed to save headers", variant: "destructive" }),
  });

  // ─── Category management ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 flex-1">
            <Settings2 className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Settings</span>
          </div>
          <button
            onClick={toggle}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            data-testid="button-theme"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">

        {/* ─── Report Header Configuration ─────────────────────────────── */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <Type className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Report Headers</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Customize the title that appears at the top of printed expense reports.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="monthly-header" className="flex items-center gap-1.5 mb-1.5">
                <Receipt className="w-3.5 h-3.5 text-green-600" />
                Monthly report title
              </Label>
              <Input
                id="monthly-header"
                value={monthlyHeader}
                onChange={e => { setMonthlyHeader(e.target.value); setHeadersDirty(true); }}
                placeholder="Monthly Expense Report"
                data-testid="input-monthly-header"
              />
            </div>
            <div>
              <Label htmlFor="travel-header" className="flex items-center gap-1.5 mb-1.5">
                <Plane className="w-3.5 h-3.5 text-blue-600" />
                Travel report title
              </Label>
              <Input
                id="travel-header"
                value={travelHeader}
                onChange={e => { setTravelHeader(e.target.value); setHeadersDirty(true); }}
                placeholder="Travel Expense Report"
                data-testid="input-travel-header"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => saveHeadersMutation.mutate()}
              disabled={!headersDirty || saveHeadersMutation.isPending}
              data-testid="button-save-headers"
            >
              {saveHeadersMutation.isPending ? "Saving…" : "Save Headers"}
            </Button>
            {!headersDirty && !saveHeadersMutation.isPending && (
              <span className="text-xs text-muted-foreground">Up to date</span>
            )}
          </div>

          <div className="mt-3 p-3 bg-muted/50 rounded-md text-xs text-muted-foreground">
            <strong>Preview — Monthly:</strong> {monthlyHeader || "Monthly Expense Report"}<br />
            <strong>Preview — Travel:</strong> {travelHeader || "Travel Expense Report"}
          </div>
        </Card>

        {/* ─── Category Management ──────────────────────────────────────── */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <Settings2 className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Expense Categories</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Add, rename, or remove categories for each report type. Click a category name to rename it.
          </p>

          <Tabs defaultValue="monthly">
            <TabsList className="mb-4">
              <TabsTrigger value="monthly" className="gap-1.5">
                <Receipt className="w-3.5 h-3.5" />Monthly
              </TabsTrigger>
              <TabsTrigger value="travel" className="gap-1.5">
                <Plane className="w-3.5 h-3.5" />Travel
              </TabsTrigger>
            </TabsList>

            <TabsContent value="monthly">
              <CategoryPanel reportType="monthly" />
            </TabsContent>
            <TabsContent value="travel">
              <CategoryPanel reportType="travel" />
            </TabsContent>
          </Tabs>
        </Card>

      </main>
    </div>
  );
}

// ─── Category Panel (inline, no dialog) ────────────────────────────────────
function CategoryPanel({ reportType }: { reportType: "monthly" | "travel" }) {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  const { data: cats = [], isLoading } = useQuery<Category[]>({
    queryKey: ["/api/categories", reportType],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/categories/${reportType}`);
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/categories", {
        reportType, name, sortOrder: cats.length, isDefault: false,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories", reportType] });
      setNewName("");
      toast({ title: "Category added" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await apiRequest("PATCH", `/api/categories/${id}`, { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories", reportType] });
      setEditingId(null);
      toast({ title: "Category renamed" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories", reportType] });
    },
  });

  return (
    <div className="space-y-4">
      {/* Category list */}
      <div className="space-y-1 max-h-72 overflow-y-auto pr-1 border border-border rounded-md p-2">
        {isLoading ? (
          <div className="space-y-2 p-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-9 rounded bg-muted animate-pulse" />
            ))}
          </div>
        ) : cats.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            No categories yet. Add one below.
          </div>
        ) : (
          cats.map((cat, idx) => (
            <div
              key={cat.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 group"
              data-testid={`category-row-${cat.id}`}
            >
              <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0 opacity-40" />
              <span className="w-6 text-xs text-muted-foreground text-right flex-shrink-0">{idx + 1}.</span>
              {editingId === cat.id ? (
                <Input
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && editingName.trim()) {
                      updateMutation.mutate({ id: cat.id, name: editingName.trim() });
                    }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="h-7 text-sm flex-1"
                  autoFocus
                  data-testid={`input-edit-category-${cat.id}`}
                />
              ) : (
                <span
                  className="flex-1 text-sm cursor-pointer hover:text-primary transition-colors"
                  onClick={() => { setEditingId(cat.id); setEditingName(cat.name); }}
                  data-testid={`text-category-name-${cat.id}`}
                >
                  {cat.name}
                  {cat.isDefault && <span className="text-xs text-muted-foreground ml-1.5">(default)</span>}
                </span>
              )}
              {editingId === cat.id ? (
                <div className="flex gap-1 flex-shrink-0">
                  <Button
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={() => editingName.trim() && updateMutation.mutate({ id: cat.id, name: editingName.trim() })}
                    disabled={!editingName.trim()}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    className="h-7 text-xs px-2"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <button
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive transition-all flex-shrink-0"
                  onClick={() => deleteMutation.mutate(cat.id)}
                  data-testid={`button-delete-category-${cat.id}`}
                  title="Delete category"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add new */}
      <Separator />
      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && newName.trim()) addMutation.mutate(newName.trim()); }}
          placeholder="New category name…"
          className="text-sm"
          data-testid={`input-new-category-${reportType}`}
        />
        <Button
          onClick={() => newName.trim() && addMutation.mutate(newName.trim())}
          disabled={!newName.trim() || addMutation.isPending}
          className="gap-1.5 flex-shrink-0"
          data-testid={`button-add-category-${reportType}`}
        >
          <Plus className="w-4 h-4" /> Add
        </Button>
      </div>
    </div>
  );
}
