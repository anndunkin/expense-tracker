import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { Category } from "@shared/schema";
import { Plus, Trash2, GripVertical } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  reportType: "monthly" | "travel";
}

export default function CategoryManagerDialog({ open, onOpenChange, reportType }: Props) {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  const { data: categories = [], isLoading } = useQuery<Category[]>({
    queryKey: ["/api/categories", reportType],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/categories/${reportType}`);
      return res.json();
    },
    enabled: open,
  });

  const addMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/categories", {
        reportType,
        name,
        sortOrder: categories.length,
        isDefault: false,
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

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    addMutation.mutate(name);
  };

  const handleEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditingName(cat.name);
  };

  const handleSaveEdit = () => {
    if (editingId && editingName.trim()) {
      updateMutation.mutate({ id: editingId, name: editingName.trim() });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Categories</DialogTitle>
          <DialogDescription>
            {reportType === "monthly" ? "Monthly" : "Travel"} expense categories
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-9 rounded bg-muted animate-pulse" />)}
            </div>
          ) : categories.map(cat => (
            <div
              key={cat.id}
              className="flex items-center gap-2 p-2 rounded-md hover:bg-accent/50 group"
              data-testid={`category-row-${cat.id}`}
            >
              <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              {editingId === cat.id ? (
                <Input
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") setEditingId(null); }}
                  className="h-7 text-sm flex-1"
                  autoFocus
                  data-testid={`input-edit-category-${cat.id}`}
                />
              ) : (
                <span
                  className="flex-1 text-sm cursor-pointer hover:text-primary transition-colors"
                  onClick={() => handleEdit(cat)}
                  data-testid={`text-category-name-${cat.id}`}
                >
                  {cat.name}
                  {cat.isDefault && <span className="text-xs text-muted-foreground ml-1">(default)</span>}
                </span>
              )}
              {editingId === cat.id ? (
                <div className="flex gap-1">
                  <Button size="sm" className="h-7 text-xs px-2" onClick={handleSaveEdit}>Save</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => setEditingId(null)}>Cancel</Button>
                </div>
              ) : (
                <button
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive transition-all"
                  onClick={() => deleteMutation.mutate(cat.id)}
                  data-testid={`button-delete-category-${cat.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-2 border-t border-border">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
            placeholder="New category name…"
            className="text-sm"
            data-testid="input-new-category"
          />
          <Button onClick={handleAdd} disabled={!newName.trim()} className="gap-1.5" data-testid="button-add-category">
            <Plus className="w-4 h-4" /> Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
