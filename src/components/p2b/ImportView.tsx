"use client";

import { useRef, useState } from "react";
import { useP2B } from "@/lib/p2b/store";
import { runPipeline } from "@/lib/p2b/pipeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "./bits";
import {
  BookOpenCheck,
  FileDown,
  FileText,
  FlaskConical,
  FolderTree,
  Info,
  ListChecks,
  Loader2,
  Lock,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { ViewId } from "@/lib/p2b/types";
import { timeAgo } from "./format";

const FEATURES = [
  {
    icon: <BookOpenCheck className="h-4 w-4" />,
    title: "Evidence-first extraction",
    desc: "Method, data, hyperparameters and metrics as individual claims — each linked to a source span. Reported stays separate from inferred.",
  },
  {
    icon: <ListChecks className="h-4 w-4" />,
    title: "Uncertainty made explicit",
    desc: "Unknowns, conflicts and blockers stay visible. An explicit unknown beats an invented value — always.",
  },
  {
    icon: <FolderTree className="h-4 w-4" />,
    title: "Deterministic scaffold",
    desc: "PyTorch / Hugging Face project files with provenance comments and traceable TODOs. Regeneration is predictable.",
  },
  {
    icon: <FlaskConical className="h-4 w-4" />,
    title: "Honest run comparison",
    desc: "Reported vs measured with protocol mismatches. \u2018Reproduced\u2019 is never awarded automatically.",
  },
];

export function ImportView() {
  const store = useP2B();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const projects = Object.values(store.projects).sort(
    (a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "")
  );

  const launch = (input: Parameters<typeof runPipeline>[0]) => {
    if (busy) return;
    setBusy(true);
    store.startProcessing([
      { id: "resolve", label: "Resolve source & identity" },
      { id: "parse", label: "Parse document" },
      { id: "segment", label: "Segment sections" },
      { id: "extract", label: "Extract claims" },
      { id: "verify", label: "Verify anchors" },
      { id: "schema", label: "Validate schema" },
      { id: "prepare", label: "Prepare workspace" },
    ]);
    void runPipeline(input, () => setBusy(false));
  };

  const submitUrl = () => {
    const v = url.trim();
    if (!v) {
      toast({
        title: "Paper field is empty",
        description: "Paste an arXiv link (e.g. https://arxiv.org/abs/1706.03762) or a DOI URL.",
      });
      return;
    }
    launch({ kind: "url", urlText: v });
  };

  const submitPdf = () => {
    if (!file) {
      toast({ title: "No PDF selected", description: "Choose a text-based PDF (not a scan)." });
      return;
    }
    if (file.size > 40 * 1024 * 1024) {
      toast({
        title: "PDF too large",
        description: "Limit is 40 MB. Export a smaller PDF or use the arXiv link.",
      });
      return;
    }
    launch({ kind: "pdf", file });
  };

  const loadDemo = () => {
    const id = store.loadDemo();
    toast({
      title: "Guided example loaded",
      description: "Curated fixture: Attention Is All You Need — includes a real conflict to resolve.",
    });
    store.setView("overview");
    void id;
  };

  const openProject = (id: string, view: ViewId = "overview") => {
    useP2B.setState({ activeProjectId: id, view });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center justify-between px-4 lg:px-8">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
              <ScrollText className="h-4.5 w-4.5" />
            </span>
            <div>
              <p className="font-display text-[15px] font-bold leading-tight">Paper2Bench</p>
              <p className="text-[10.5px] uppercase tracking-widest text-sidebar-foreground/50">
                paper → evidence → scaffold → verify
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/70"
            onClick={() => store.setView("settings")}
          >
            <Lock className="h-3.5 w-3.5" /> Local-only mode
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] px-4 py-10 lg:px-8">
        {/* Hero + import */}
        <section className="hero-band rounded-2xl border border-border p-6 lg:p-10">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/8 px-3 py-1 text-[11.5px] font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" /> Evidence-first research engineering
              </p>
              <h1 className="font-display text-3xl font-bold leading-[1.15] tracking-tight lg:text-[40px]">
                Turn an ML paper into an{" "}
                <span className="text-primary">evidence-backed experiment</span>.
              </h1>
              <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
                Paper2Bench extracts a structured record of a paper&apos;s method, data, training
                setup and results — links every claim to its source, keeps what is{" "}
                <em>known, inferred, missing or conflicting</em> visibly separate, and generates a
                deterministic project scaffold. What you actually ran is recorded apart from what
                the paper claims.
              </p>
              <ul className="mt-5 space-y-2 text-[13.5px] text-muted-foreground">
                <li className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[var(--success)]" />
                  Truth before completeness — unknowns are never silently filled
                </li>
                <li className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-primary" />
                  Local-first: parsing happens in your browser; projects stay on your machine
                </li>
                <li className="flex items-center gap-2">
                  <FileDown className="h-4 w-4 text-primary" />
                  Export a portable ZIP: scaffold, evidence ledger, run manifests, report
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <h2 className="font-display text-lg font-semibold">Start a project</h2>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                arXiv link, DOI, or a PDF you already have. No account needed.
              </p>

              <Tabs defaultValue="url" className="mt-4">
                <TabsList className="grid w-full grid-cols-2 bg-muted">
                  <TabsTrigger value="url" className="gap-1.5">
                    <FileText className="h-3.5 w-3.5" /> URL / DOI
                  </TabsTrigger>
                  <TabsTrigger value="pdf" className="gap-1.5">
                    <UploadCloud className="h-3.5 w-3.5" /> Upload PDF
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="url" className="mt-4 space-y-3">
                  <label htmlFor="paper-url" className="text-[12.5px] font-medium">
                    Paper URL or DOI
                  </label>
                  <Input
                    id="paper-url"
                    placeholder="https://arxiv.org/abs/1706.03762"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitUrl()}
                    className="h-10"
                    aria-describedby="url-help"
                  />
                  <p id="url-help" className="text-[11.5px] text-muted-foreground">
                    Supported: arxiv.org and doi.org links. Other venues: download the PDF and
                    upload it — remote fetching of arbitrary hosts is blocked by policy.
                  </p>
                  <Button
                    onClick={submitUrl}
                    disabled={busy}
                    className="h-10 w-full gap-2 font-medium"
                    size="lg"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Analyze paper
                  </Button>
                </TabsContent>

                <TabsContent value="pdf" className="mt-4 space-y-3">
                  <label htmlFor="paper-pdf" className="text-[12.5px] font-medium">
                    PDF upload <span className="text-muted-foreground">(≤ 40 MB, text-based; parsed locally)</span>
                  </label>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-input px-4 py-7 text-center transition-colors hover:border-primary/60 hover:bg-accent/40"
                    aria-label="Choose PDF file to upload"
                  >
                    <UploadCloud className="h-6 w-6 text-primary" />
                    <span className="text-[13px] font-medium">
                      {file ? file.name : "Click to choose a PDF"}
                    </span>
                    <span className="text-[11.5px] text-muted-foreground">
                      Drag-and-drop is not required — keyboard users can open the file picker here.
                    </span>
                  </button>
                  <input
                    ref={fileRef}
                    id="paper-pdf"
                    type="file"
                    accept="application/pdf,.pdf"
                    className="sr-only"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <Button
                    onClick={submitPdf}
                    disabled={busy || !file}
                    className="h-10 w-full gap-2 font-medium"
                    size="lg"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Analyze PDF
                  </Button>
                </TabsContent>
              </Tabs>

              <div className="mt-4 rounded-lg border border-amber-warm/40 bg-[color-mix(in_srgb,var(--amber-warm)_9%,transparent)] p-3 text-[12px] leading-relaxed text-foreground/85">
                <p className="flex items-start gap-2">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
                  <span>
                    <strong>Privacy:</strong> PDF parsing happens locally in your browser. If you
                    enable LLM extraction in Settings, paper text is sent to the configured model
                    provider — that requires explicit opt-in and is disclosed there. Default is
                    local heuristic extraction.
                  </span>
                </p>
              </div>

              <Button variant="outline" onClick={loadDemo} className="mt-3 w-full gap-2">
                <BookOpenCheck className="h-4 w-4 text-primary" />
                Load guided example (no network needed)
              </Button>
            </div>
          </div>
        </section>

        {/* Feature pillars */}
        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Product pillars">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                {f.icon}
              </div>
              <p className="text-[13.5px] font-semibold">{f.title}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </section>

        {/* Recent projects */}
        <section className="mt-10" aria-label="Recent projects">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Recent projects</h2>
            {projects.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground"
                onClick={() => {
                  if (confirm("Delete ALL local projects? Export first if you need copies. This cannot be undone.")) {
                    useP2B.setState({ projects: {}, activeProjectId: null });
                    toast({ title: "All local projects deleted." });
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear all
              </Button>
            ) : null}
          </div>
          {projects.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-8 w-8" />}
              title="No projects yet"
              hint="Load the guided example to explore the full workflow — evidence ledger, conflict resolution, scaffold generation, validation and run comparison — without any network access."
              action={
                <Button variant="outline" size="sm" onClick={loadDemo} className="gap-2">
                  <BookOpenCheck className="h-4 w-4" /> Load guided example
                </Button>
              }
            />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => openProject(p.id)}
                    className="group w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50"
                  >
                    <p className="line-clamp-2 text-[13.5px] font-semibold group-hover:text-primary">
                      {p.paper.title}
                    </p>
                    <p className="mt-1 text-[11.5px] text-muted-foreground">
                      {p.paper.source_kind.toUpperCase()} · {p.claims.length} claims · updated {timeAgo(p.updated_at)}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground">
                        {p.runs.length} runs
                      </span>
                      {p.scaffold ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] text-primary">
                          scaffold ready
                        </span>
                      ) : null}
                      {p.claims.some((c) => c.evidence_status === "conflicting") ? (
                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10.5px] text-destructive">
                          conflicts
                        </span>
                      ) : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
