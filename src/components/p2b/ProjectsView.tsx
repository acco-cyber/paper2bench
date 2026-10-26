"use client";

import { useMemo, useState } from "react";
import { useP2B } from "@/lib/p2b/store";
import { organizeCards, workspaceStats, type CardSort, type WorkspaceCard } from "@/lib/p2b/insights";
import { SectionHeading, StatusPill } from "./bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { timeAgo } from "./format";
import {
  Archive,
  ArchiveRestore,
  BookOpenCheck,
  Copy,
  FileText,
  FlaskConical,
  FolderTree,
  Layers,
  MoreVertical,
  Pin,
  PinOff,
  Plus,
  Search,
  Star,
  Trash2,
  Wrench,
} from "lucide-react";

/**
 * Projects dashboard — the workspace library.
 * Every project with an auditable readiness score, search/sort,
 * pin / archive / duplicate / rename / delete, and workspace aggregates.
 */

function ScoreRing({ score }: { score: number }) {
  const r = 15.5;
  const c = 2 * Math.PI * r;
  const filled = (score / 100) * c;
  const tone =
    score >= 90 ? "var(--success)" : score >= 45 ? "var(--primary)" : score >= 20 ? "var(--warning)" : "var(--destructive)";
  return (
    <div className="relative h-11 w-11 shrink-0" role="img" aria-label={`Readiness ${score} of 100`}>
      <svg viewBox="0 0 40 40" className="h-11 w-11 -rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" stroke="color-mix(in srgb, var(--muted-foreground) 25%, transparent)" strokeWidth="4" />
        <circle
          cx="20" cy="20" r={r} fill="none"
          stroke={tone}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-[12.5px] font-bold">
        {score}
      </span>
    </div>
  );
}

function ProjectCard({ card, onOpen }: { card: WorkspaceCard; onOpen: (id: string) => void }) {
  const archiveProject = useP2B((s) => s.archiveProject);
  const pinProject = useP2B((s) => s.pinProject);
  const duplicateProject = useP2B((s) => s.duplicateProject);
  const deleteProject = useP2B((s) => s.deleteProject);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      className={cn(
        "group relative rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50",
        card.archived && "opacity-70"
      )}
    >
      <div className="flex items-start gap-3">
        <ScoreRing score={card.readiness.total} />
        <button onClick={() => onOpen(card.id)} className="min-w-0 flex-1 text-left" aria-label={`Open project ${card.title}`}>
          <p className="line-clamp-2 pr-6 text-[13.5px] font-semibold leading-snug group-hover:text-primary">
            {card.pinned ? <Pin className="mr-1 inline h-3 w-3 -translate-y-px text-primary" aria-label="Pinned" /> : null}
            {card.title}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {card.source_kind.toUpperCase()} · {card.claims} claims · {card.runs} run{card.runs === 1 ? "" : "s"} · updated {timeAgo(card.updated_at)}
          </p>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`Project actions for ${card.title}`}>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => pinProject(card.id, !card.pinned)}>
              {card.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              {card.pinned ? "Unpin" : "Pin to top"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => duplicateProject(card.id)}>
              <Copy className="h-4 w-4" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => archiveProject(card.id, !card.archived)}>
              {card.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              {card.archived ? "Restore from archive" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setConfirmDelete(true)} className="text-destructive focus:text-destructive">
              <Trash2 className="h-4 w-4" /> Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button onClick={() => onOpen(card.id)} className="mt-3 flex w-full flex-wrap gap-1.5 text-left">
        <StatusPill tone={card.readiness.verdict === "ready" ? "good" : card.readiness.verdict === "blocked" ? "bad" : "neutral"}>
          {card.readiness.verdict_label}
        </StatusPill>
        {card.conflicts ? (
          <StatusPill tone="bad">{card.conflicts} conflict{card.conflicts > 1 ? "s" : ""}</StatusPill>
        ) : null}
        {card.blockers ? <StatusPill tone="warn">{card.blockers} blocker{card.blockers > 1 ? "s" : ""}</StatusPill> : null}
        {card.has_scaffold ? (
          <StatusPill tone="good">
            <FolderTree className="h-3 w-3" /> scaffold
          </StatusPill>
        ) : null}
        {card.provisional ? <StatusPill tone="warn">provisional</StatusPill> : null}
        {card.tasks_total ? (
          <StatusPill tone="neutral">
            <Wrench className="h-3 w-3" /> {card.tasks_done}/{card.tasks_total}
          </StatusPill>
        ) : null}
        {card.runs ? (
          <StatusPill tone="neutral">
            <FlaskConical className="h-3 w-3" /> measured
          </StatusPill>
        ) : null}
      </button>

      <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2.5">
        <p className="truncate text-[11.5px] text-muted-foreground">Next: {card.next}</p>
        <div className="hidden shrink-0 gap-1 lg:flex">
          {card.readiness.subs.map((s) => (
            <span
              key={s.id}
              title={`${s.label}: ${s.score}/100`}
              className="h-1.5 w-8 overflow-hidden rounded-full bg-muted"
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${s.score}%`,
                  background: s.score >= 70 ? "var(--success)" : s.score >= 40 ? "var(--amber-warm)" : "var(--destructive)",
                }}
              />
            </span>
          ))}
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              “{card.title}” and all of its claims, plans, runs and files will be permanently removed from
              this browser. Export a ZIP first if you might need it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep project</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                deleteProject(card.id);
                setConfirmDelete(false);
                toast({ title: "Project deleted", description: card.title });
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ProjectsView() {
  const projects = useP2B((s) => s.projects);
  const setView = useP2B((s) => s.setView);
  const loadDemo = useP2B((s) => s.loadDemo);

  const [q, setQ] = useState("");
  const [sort, setSort] = useState<CardSort>("recent");
  const [showArchived, setShowArchived] = useState(false);

  const all = useMemo(() => Object.values(projects), [projects]);
  const cards = useMemo(() => organizeCards(all, { q, sort, showArchived }), [all, q, sort, showArchived]);
  const stats = useMemo(() => workspaceStats(all), [all]);

  const open = (id: string) => useP2B.setState({ activeProjectId: id, view: "overview" });

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Projects"
        desc="Your local library of reproduction projects. Every card shows the auditable readiness score — what is done, what is missing, and where to fix it."
        right={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadDemo} className="gap-1.5">
              <BookOpenCheck className="h-3.5 w-3.5" /> Guided example
            </Button>
            <Button size="sm" onClick={() => setView("import")} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> New paper
            </Button>
          </div>
        }
      />

      {/* Workspace stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: "Projects", value: String(stats.total), icon: <Layers className="h-4 w-4" /> },
          { label: "Active", value: String(stats.active), icon: <FileText className="h-4 w-4" /> },
          { label: "Avg readiness", value: `${stats.avg_readiness}/100`, icon: <Star className="h-4 w-4" /> },
          { label: "Runs recorded", value: String(stats.total_runs), icon: <FlaskConical className="h-4 w-4" /> },
          { label: "Criteria passed", value: String(stats.criteria_passed), icon: <Wrench className="h-4 w-4" /> },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <span className="text-muted-foreground">{s.icon}</span>
            </div>
            <p className="mt-1 font-display text-xl font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search project titles…"
            className="pl-9"
            aria-label="Search projects"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as CardSort)}>
          <SelectTrigger className="w-[170px]" aria-label="Sort projects">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Recently updated</SelectItem>
            <SelectItem value="name">Title A→Z</SelectItem>
            <SelectItem value="readiness">Readiness score</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={showArchived ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowArchived((v) => !v)}
          className="gap-1.5"
          aria-pressed={showArchived}
        >
          <Archive className="h-3.5 w-3.5" />
          {showArchived ? "Hiding nothing — archived shown" : "Show archived"}
        </Button>
      </div>

      {/* Cards */}
      {cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 px-6 text-center">
          <Layers className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">
            {all.length === 0 ? "No projects yet" : showArchived ? "No matches" : "No active projects"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {all.length === 0
              ? "Start from an arXiv link, a DOI or a local PDF — or load the guided example to explore the whole workflow offline."
              : showArchived
                ? "Nothing matches the current search and filters."
                : "Every project is archived. Use “Show archived” to find it, or start something new."}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadDemo} className="gap-1.5">
              <BookOpenCheck className="h-3.5 w-3.5" /> Guided example
            </Button>
            <Button size="sm" onClick={() => setView("import")} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> New paper
            </Button>
          </div>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <li key={c.id}>
              <ProjectCard card={c} onOpen={open} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
