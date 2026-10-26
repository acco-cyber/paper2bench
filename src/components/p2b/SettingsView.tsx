"use client";

import { useEffect, useState } from "react";
import { useP2B } from "@/lib/p2b/store";
import type { ExtractionEngine, PrivacyMode } from "@/lib/p2b/types";
import { SectionHeading } from "./bits";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { fmtDateTime } from "./format";

interface HealthInfo {
  status: string;
  version: string;
  capabilities: Record<string, boolean>;
}

/** Screen N — preferences & local privacy. */
export function SettingsView() {
  const settings = useP2B((s) => s.settings);
  const updateSettings = useP2B((s) => s.updateSettings);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealthErr("Health endpoint unreachable — running in fully local mode."));
  }, []);

  return (
    <div className="max-w-3xl space-y-5">
      <SectionHeading
        title="Settings & privacy"
        desc="Provider, privacy mode, telemetry and retention. Local-only is the default; anything that leaves your machine requires explicit opt-in."
      />

      {/* Privacy mode */}
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
          <ShieldCheck className="h-4.5 w-4.5 text-primary" /> Privacy mode
        </p>
        <div className="grid gap-2.5">
          <PrivacyOption
            selected={settings.privacy_mode === "local_only"}
            onSelect={() => updateSettings({ privacy_mode: "local_only", extraction_engine: settings.extraction_engine === "llm" ? "heuristic" : settings.extraction_engine })}
            icon={<WifiOff className="h-4.5 w-4.5 text-[var(--success)]" />}
            title="Local-only (default)"
            desc="PDF parsing and heuristic extraction happen entirely in your browser. Projects stay in localStorage. No paper text leaves your machine."
          />
          <PrivacyOption
            selected={settings.privacy_mode === "remote_optin"}
            onSelect={() => {
              const ok = window.confirm(
                "Enable remote processing?\n\nPaper text (title, abstract, and full text when available) will be sent to the configured model provider for higher-quality extraction. This requires your explicit opt-in — it is never enabled silently."
              );
              if (ok) {
                updateSettings({ privacy_mode: "remote_optin", extraction_engine: "llm" });
                toast({ title: "Remote extraction enabled", description: "LLM-assisted extraction will be attempted; local heuristic runs as fallback." });
              }
            }}
            icon={<Wifi className="h-4.5 w-4.5 text-[var(--warning)]" />}
            title="Remote extraction (explicit opt-in)"
            desc="LLM-assisted structured extraction via the configured provider. Disclosure: paper text is transmitted. Local fallback engages automatically if the provider is unreachable."
          />
        </div>
      </div>

      {/* Extraction engine */}
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="mb-1 text-[14px] font-semibold">Extraction engine</p>
        <p className="mb-3 text-[12.5px] text-muted-foreground">
          {settings.privacy_mode === "local_only"
            ? "Local-only mode restricts the engine to the deterministic heuristic extractor."
            : "LLM mode sends section windows to the provider with a strict evidence-first prompt; unsupported values stay unspecified."}
        </p>
        <div className="flex gap-2">
          <Button
            variant={settings.extraction_engine === "heuristic" ? "default" : "outline"}
            size="sm"
            onClick={() => updateSettings({ extraction_engine: "heuristic", privacy_mode: settings.privacy_mode })}
          >
            Heuristic (local, deterministic)
          </Button>
          <Button
            variant={settings.extraction_engine === "llm" ? "default" : "outline"}
            size="sm"
            disabled={settings.privacy_mode === "local_only"}
            onClick={() => updateSettings({ extraction_engine: "llm", privacy_mode: "remote_optin" })}
          >
            LLM (provider, opt-in)
          </Button>
        </div>
      </div>

      {/* Telemetry */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card p-5">
        <div>
          <Label className="text-[14px] font-semibold">Telemetry</Label>
          <p className="mt-0.5 max-w-lg text-[12.5px] text-muted-foreground">
            Off by default. If ever enabled, only coarse event counts are collected — never manuscript text,
            prompts, source passages, dataset paths, config contents or metrics.
          </p>
        </div>
        <Switch
          checked={settings.telemetry}
          onCheckedChange={(v) => {
            if (v) {
              toast({ title: "Telemetry stays off in this build", description: "No analytics collection is implemented; the switch records your preference only." });
            }
            updateSettings({ telemetry: v });
          }}
          aria-label="Telemetry"
        />
      </div>

      {/* Server status */}
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="mb-2 text-[14px] font-semibold">Server capabilities</p>
        {healthErr ? (
          <p className="flex items-center gap-2 text-[12.5px] text-[var(--warning)]">
            <AlertTriangle className="h-4 w-4" /> {healthErr}
          </p>
        ) : health ? (
          <ul className="space-y-1.5 text-[12.5px]">
            {Object.entries(health.capabilities).map(([k, v]) => (
              <li key={k} className="flex items-center gap-2">
                {v ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)]" />
                )}
                <span className="font-mono">{k}</span>
                <span className="text-muted-foreground">{v ? "available" : "disabled by policy"}</span>
              </li>
            ))}
            <li className="pt-1 text-[11.5px] text-muted-foreground">
              backend {health.status} · v{health.version}
            </li>
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">checking…</p>
        )}
        <p className="mt-3 rounded-lg bg-muted/60 p-3 text-[12px] leading-relaxed text-muted-foreground">
          <strong>Policy:</strong> generated code is never executed by the hosted app. Validation checks that
          require execution (install, smoke, end-to-end) are reported as blocked with local instructions instead
          of being silently skipped.
        </p>
      </div>

      {/* Data & retention */}
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="mb-1 text-[14px] font-semibold">Local data & retention</p>
        <p className="mb-3 text-[12.5px] text-muted-foreground">
          Projects live in your browser&apos;s localStorage. Temporary PDF text lives only in memory during
          processing. Deleting a project removes it locally — nothing was stored server-side.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => {
              const s = useP2B.getState();
              const data = JSON.stringify({ settings: s.settings, projects: s.projects }, null, 2);
              const blob = new Blob([data], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "paper2bench_settings_and_projects.json";
              a.click();
              URL.revokeObjectURL(url);
              toast({ title: "Settings + projects exported (no secrets included)" });
            }}
          >
            <Download className="h-3.5 w-3.5" /> Export settings & projects
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="gap-2"
            onClick={() => {
              if (
                window.confirm(
                  "Delete ALL local data (projects + settings)?\n\nExport first if you need a copy. This clears localStorage and cannot be undone."
                )
              ) {
                localStorage.removeItem("paper2bench-store-v1");
                window.location.reload();
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete all local data
          </Button>
        </div>
        <p className="mt-3 text-[11.5px] text-muted-foreground">Last export check: {fmtDateTime(new Date().toISOString())}</p>
      </div>
    </div>
  );
}

function PrivacyOption({
  selected,
  onSelect,
  icon,
  title,
  desc,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-start gap-3 rounded-lg border p-3.5 text-left transition-colors ${
        selected ? "border-primary bg-primary/8" : "border-border hover:border-primary/40"
      }`}
    >
      <span className="mt-0.5">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">{desc}</span>
      </span>
      {selected ? <CheckCircle2 className="ml-auto h-4.5 w-4.5 shrink-0 text-primary" /> : null}
    </button>
  );
}
