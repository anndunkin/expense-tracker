import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/components/ThemeProvider";
import { useToast } from "@/hooks/use-toast";
import type { ExpenseReport } from "@shared/schema";
import {
  FileText, Plus, FolderOpen, Trash2, Moon, Sun, Receipt,
  Plane, Calendar, ChevronRight, Settings2
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function HomePage() {
  const [, navigate] = useLocation();
  const { theme, toggle } = useTheme();
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: reports = [], isLoading } = useQuery<ExpenseReport[]>({
    queryKey: ["/api/reports"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/reports/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      toast({ title: "Report deleted" });
    },
  });

  // File open handler — trigger file input
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
        toast({ title: "Report opened", description: imported.report.name });
        navigate(`/report/${imported.report.id}`);
      } catch {
        toast({ title: "Error opening file", description: "Invalid expense report file.", variant: "destructive" });
      }
    };
    input.click();
  };

  const sortedReports = [...reports].sort((a, b) => b.id - a.id);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <Receipt className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground leading-none">ExpenseTrack</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Expense Reporting System</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate("/settings")}
              className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label="Settings"
              data-testid="button-settings"
              title="Settings"
            >
              <Settings2 className="w-4 h-4" />
            </button>
            <button
              onClick={toggle}
              className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label="Toggle theme"
              data-testid="button-theme-toggle"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Actions */}
        <div className="flex flex-wrap gap-3 mb-10">
          <Button
            onClick={() => navigate("/report/new/monthly")}
            className="gap-2"
            data-testid="button-new-monthly"
          >
            <Plus className="w-4 h-4" />
            New Monthly Report
          </Button>
          <Button
            onClick={() => navigate("/report/new/travel")}
            variant="secondary"
            className="gap-2"
            data-testid="button-new-travel"
          >
            <Plane className="w-4 h-4" />
            New Travel Report
          </Button>
          <Button
            onClick={handleOpenFile}
            variant="outline"
            className="gap-2"
            data-testid="button-open-file"
          >
            <FolderOpen className="w-4 h-4" />
            Open File
          </Button>
        </div>

        {/* Reports list */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Saved Reports
          </h2>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : sortedReports.length === 0 ? (
            <div className="border border-dashed border-border rounded-lg p-12 text-center">
              <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No reports yet. Create one above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedReports.map(report => (
                <Card
                  key={report.id}
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-accent/50 transition-colors group"
                  onClick={() => navigate(`/report/${report.id}`)}
                  data-testid={`card-report-${report.id}`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    report.type === "travel" ? "bg-blue-100 dark:bg-blue-900/40" : "bg-green-100 dark:bg-green-900/40"
                  }`}>
                    {report.type === "travel"
                      ? <Plane className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      : <Calendar className="w-4 h-4 text-green-600 dark:text-green-400" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground truncate">{report.name}</span>
                      <Badge variant={report.status === "draft" ? "secondary" : "default"} className="text-xs flex-shrink-0">
                        {report.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {report.submitterName && `${report.submitterName} · `}
                      {report.tripPurpose || "No purpose specified"}
                      {report.dateSubmitted && ` · ${report.dateSubmitted}`}
                    </p>
                    {report.filePath && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5 flex items-center gap-1 min-w-0">
                        <FolderOpen className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate" title={report.filePath}>{report.filePath}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      onClick={(e) => { e.stopPropagation(); setDeleteId(report.id); }}
                      data-testid={`button-delete-report-${report.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this report?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
