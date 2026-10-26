"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useP2B } from "@/lib/p2b/store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ViewId } from "@/lib/p2b/types";

/**
 * Keyboard shortcut reference + direct navigation.
 * Alt + number jumps between views; works from any screen.
 */

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "⌘ K / Ctrl K", action: "Open the command palette (search everything)" },
  { keys: "?", action: "Show this shortcuts reference" },
  { keys: "Alt + 1…9", action: "Jump to a view (order shown below)" },
  { keys: "Esc", action: "Close dialogs and panels" },
];

const VIEW_ORDER: { id: ViewId; label: string }[] = [
  { id: "projects", label: "Projects" },
  { id: "overview", label: "Overview" },
  { id: "evidence", label: "Evidence ledger" },
  { id: "plan", label: "Reproduction plan" },
  { id: "datasets", label: "Dataset audit" },
  { id: "compute", label: "Compute estimate" },
  { id: "files", label: "Project files" },
  { id: "validation", label: "Validation" },
  { id: "runs", label: "Runs & results" },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const setView = useP2B((s) => s.setView);
  const { resolvedTheme, setTheme } = useTheme();

  // Alt+1..9 direct view jumping — registered only while the dialog is closed
  // so numbers typed inside form fields are never hijacked.
  useEffect(() => {
    if (open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > VIEW_ORDER.length) return;
      e.preventDefault();
      setView(VIEW_ORDER[n - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setView]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Paper2Bench is keyboard-first. Every view and power action is reachable without the mouse.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 odd:bg-muted/50">
              <span className="text-[12.5px] text-muted-foreground">{s.action}</span>
              <kbd className="shrink-0 rounded border border-border bg-muted px-2 py-0.5 font-mono text-[11px] font-semibold">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>

        <p className="pt-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Alt + number — direct view jump
        </p>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {VIEW_ORDER.map((v, i) => (
            <button
              key={v.id}
              onClick={() => {
                setView(v.id);
                onOpenChange(false);
              }}
              className="flex items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-[12.5px] transition-colors hover:border-border hover:bg-accent"
            >
              <span>
                <kbd className="mr-2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10.5px] font-semibold">
                  Alt {i + 1}
                </kbd>
                {v.label}
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="mt-1 w-full rounded-md border border-border px-3 py-2 text-[12.5px] transition-colors hover:bg-accent"
        >
          Toggle dark / light mode (also in the header and ⌘K palette)
        </button>
      </DialogContent>
    </Dialog>
  );
}
