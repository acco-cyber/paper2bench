"use client";

import { useMemo, useState } from "react";
import { useP2B, scaffoldConfigOf } from "@/lib/p2b/store";
import type { ScaffoldFramework, ScaffoldScope } from "@/lib/p2b/types";
import { SectionHeading, StatusPill, EmptyState } from "./bits";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileWarning, FolderTree, ListTodo, Wand2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { downloadText } from "@/lib/p2b/exporter";
import { formatValue } from "@/lib/p2b/semantics";

const FILE_STATUS_TONE: Record<string, string> = {
  generated: "good",
  template: "neutral",
  needs_implementation: "warn",
  validated: "good",
  user_modified: "warn",
};

/** Screen I — scaffold builder: preview before generate, diff on regenerate, never overwrite silently. */
export function FilesView() {
  const project = useP2B((s) => (s.activeProjectId ? s.projects[s.activeProjectId] : null));
  const generateScaffold = useP2B((s) => s.generateScaffold);
  const editFile = useP2B((s) => s.editScaffoldFile);
  const setView = useP2B((s) => s.setView);
  const [framework, setFramework] = useState<ScaffoldFramework>("pytorch");
  const [scope, setScope] = useState<ScaffoldScope>("baseline_target");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmDiff, setConfirmDiff] = useState<string[] | null>(null);

  const scaffold = project?.scaffold ?? null;

  const todos = useMemo(() => {
    if (!scaffold) return [] as { file: string; line: number; text: string }[];
    const out: { file: string; line: number; text: string }[] = [];
    for (const f of scaffold.files) {
      f.content.split("\n").forEach((l, i) => {
        const m = l.match(/TODO\(p2b\):?\s*(.*)/);
        if (m) out.push({ file: f.path, line: i + 1, text: m[1] });
      });
    }
    return out;
  }, [scaffold]);

  const tree = useMemo(() => {
    if (!scaffold) return [] as string[];
    return scaffold.files.map((f) => f.path).sort();
  }, [scaffold]);

  if (!project) return null;
  const config = scaffoldConfigOf(project);

  const selectedFile = scaffold?.files.find((f) => f.path === selectedPath) ?? null;

  const doGenerate = () => {
    const userModified = scaffold?.files.filter((f) => f.user_modified) ?? [];
    if (userModified.length) {
      setConfirmDiff(userModified.map((f) => f.path));
      return;
    }
    applyGenerate();
  };

  const applyGenerate = () => {
    generateScaffold(project.id, framework, scope);
    setConfirmDiff(null);
    setSelectedPath(null);
    setDraft(null);
    const unresolved = project.claims.filter(
      (c) => c.impact === "critical" && (c.evidence_status === "unspecified" || c.evidence_status === "conflicting") && c.review_status === "not_reviewed"
    ).length;
    toast({
      title: `Scaffold generated — ${unresolved ? "PROVISIONAL" : "ready to implement"}`,
      description: unresolved
        ? `${unresolved} unresolved critical claim(s): TODO(p2b) markers trace each one. You may proceed knowingly; exports will carry the warning.`
        : "Deterministic output — regenerating with unchanged claims yields the same files.",
    });
  };

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Project scaffold"
        desc="Deterministic templates: same reviewed claims + config + template version → byte-identical files. Every value carries provenance; every unknown becomes TODO(p2b). Generated code is never executed here."
      />

      {/* Builder controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div>
          <p className="mb-1 text-[12px] font-medium">Framework</p>
          <Select value={framework} onValueChange={(v) => setFramework(v as ScaffoldFramework)}>
            <SelectTrigger className="h-9 w-[220px]" aria-label="Framework">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pytorch">Generic PyTorch</SelectItem>
              <SelectItem value="huggingface">Hugging Face Trainer (Transformer-compatible only)</SelectItem>
            </SelectContent>
          </Select>
          {framework === "huggingface" ? (
            <p className="mt-1 max-w-[240px] text-[11px] text-[var(--warning)]">
              Use only for compatible Transformer workflows; custom loops fall back to the PyTorch template.
            </p>
          ) : null}
        </div>
        <div>
          <p className="mb-1 text-[12px] font-medium">Template scope</p>
          <Select value={scope} onValueChange={(v) => setScope(v as ScaffoldScope)}>
            <SelectTrigger className="h-9 w-[200px]" aria-label="Scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minimal">Minimal scaffold</SelectItem>
              <SelectItem value="baseline_target">Baseline + target method</SelectItem>
              <SelectItem value="with_ablations">Plan with ablation tasks</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {project.provisional ? (
            <span className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-[11.5px] font-medium text-destructive">
              <FileWarning className="h-3.5 w-3.5" /> provisional (unresolved criticals)
            </span>
          ) : null}
          <Button onClick={doGenerate} className="gap-2">
            <Wand2 className="h-4 w-4" />
            {scaffold ? "Regenerate files" : "Generate project"}
          </Button>
        </div>
      </div>

      {confirmDiff ? (
        <div className="rounded-xl border border-amber-warm/60 bg-[color-mix(in_srgb,var(--amber-warm)_10%,transparent)] p-4">
          <p className="text-[13px] font-semibold text-[var(--warning)]">
            Regeneration would touch {confirmDiff.length} file(s) you edited:
          </p>
          <ul className="mt-1.5 list-disc pl-5 font-mono text-[12px]">
            {confirmDiff.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                // backup user-modified copies into a branch folder, then regenerate
                const p = useP2B.getState();
                const proj = p.activeProjectId ? p.projects[p.activeProjectId] : null;
                if (proj?.scaffold) {
                  for (const f of proj.scaffold.files) {
                    if (f.user_modified) {
                      const backupPath = `backup/user_modified/${f.path}`;
                      proj.scaffold.files.push({
                        path: backupPath,
                        content: f.content,
                        status: "user_modified",
                        user_modified: true,
                      });
                    }
                  }
                  useP2B.setState({ projects: { ...p.projects, [proj.id]: proj } });
                }
                applyGenerate();
                toast({
                  title: "Regenerated — your edits preserved",
                  description: "Edited copies were kept under backup/user_modified/ before overwriting.",
                });
              }}
            >
              Back up my edits & regenerate
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmDiff(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {!scaffold ? (
        <EmptyState
          icon={<FolderTree className="h-8 w-8" />}
          title="No scaffold generated yet"
          hint="Pick a framework and scope, then generate. You will preview every file before downloading; provenance comments trace each value to its claim."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* File tree */}
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-3 py-2.5">
              <p className="text-[12px] font-semibold">
                {scaffold.files.length} files · template {scaffold.template_version}
              </p>
              <p className="text-[11px] text-muted-foreground">generated {new Date(scaffold.generated_at).toLocaleString()}</p>
            </div>
            <ul className="max-h-[480px] overflow-y-auto p-1.5">
              {tree.map((p) => {
                const f = scaffold.files.find((x) => x.path === p)!;
                const active = selectedPath === p;
                return (
                  <li key={p}>
                    <button
                      onClick={() => {
                        setSelectedPath(p);
                        setDraft(null);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-[12px] transition-colors",
                        active ? "bg-accent font-medium" : "hover:bg-accent/60"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{p}</span>
                      {f.user_modified ? <span className="shrink-0 text-[10px] font-semibold text-[var(--warning)]">edited</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Preview / editor */}
          <div className="rounded-xl border border-border bg-card">
            {selectedFile ? (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                  <p className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-semibold">{selectedFile.path}</p>
                  <StatusPill tone={FILE_STATUS_TONE[selectedFile.status]}>{selectedFile.status.replace("_", " ")}</StatusPill>
                  {selectedFile.claim_refs && selectedFile.claim_refs.length ? (
                    <button
                      onClick={() => {
                        useP2B.setState({ selectedClaimId: selectedFile.claim_refs![0] });
                        setView("evidence");
                      }}
                      className="text-[11px] text-primary hover:underline"
                    >
                      view source claims →
                    </button>
                  ) : null}
                  {draft === null ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDraft(selectedFile.content)}
                    >
                      Edit
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        onClick={() => {
                          editFile(project.id, selectedFile.path, draft);
                          setDraft(null);
                          toast({ title: "File saved", description: "Marked user-modified; regeneration will ask before overwriting." });
                        }}
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                        Cancel
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      downloadText(selectedFile.content, selectedFile.path.split("/").pop() ?? "file.txt");
                    }}
                  >
                    Download
                  </Button>
                </div>
                {draft === null ? (
                  <pre className="code-pane max-h-[520px] overflow-auto p-4 whitespace-pre">{selectedFile.content}</pre>
                ) : (
                  <textarea
                    aria-label={`Edit ${selectedFile.path}`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="code-pane h-[520px] w-full resize-y bg-transparent p-4 outline-none"
                    spellCheck={false}
                  />
                )}
              </>
            ) : (
              <div className="p-4">
                <p className="mb-3 text-[13px] font-semibold">Config values (all traced)</p>
                <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  {Object.entries(config ?? {}).map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-2 border-b border-border/50 py-1 text-[12.5px]">
                      <span className="font-mono text-muted-foreground">{k}</span>
                      <span className="font-mono">{formatValue(v as string | number | boolean | null, null)}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[12px] text-muted-foreground">
                  Select a file to preview its full content. null means the paper does not specify it.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TODO list */}
      {todos.length ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
            <ListTodo className="h-4 w-4 text-primary" /> TODO(p2b) register — {todos.length} unresolved item(s)
          </p>
          <ul className="max-h-56 space-y-1 overflow-y-auto text-[12px]">
            {todos.map((t, i) => (
              <li key={i} className="flex gap-2 rounded bg-muted/50 px-2.5 py-1.5">
                <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                  {t.file}:{t.line}
                </span>
                <span className="leading-snug">{t.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
