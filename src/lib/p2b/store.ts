"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ActivityEvent,
  Claim,
  ComputeEstimate,
  DatasetRecord,
  EvidenceStatus,
  Impact,
  PaperMeta,
  Project,
  ProtocolTask,
  ReproductionAssessment,
  ReviewStatus,
  RunManifest,
  Settings,
  ScaffoldFramework,
  ScaffoldScope,
  ViewId,
} from "./types";
import { shortHash } from "./semantics";
import { buildDemoProject } from "./demo";
import {
  PlanPreset,
  computeEstimate as runCompute,
  defaultComputeInputs,
  generateDatasetRecords,
  generatePlan,
  ComputeInputs,
} from "./planner";
import {
  ScaffoldConfig,
  TEMPLATE_VERSION,
  buildConfigFromClaims,
  generateScaffoldFiles,
} from "./scaffold";
import { runValidation } from "./validation";
import { makeAssessment, ComparisonRow } from "./comparison";

interface P2BStore {
  view: ViewId;
  activeProjectId: string | null;
  projects: Record<string, Project>;
  settings: Settings;
  processing: {
    active: boolean;
    stages: { id: string; label: string; status: string; detail?: string }[];
  } | null;
  selectedClaimId: string | null;
  evidenceFilters: {
    q: string;
    category: string;
    status: string;
    impact: string;
    review: string;
  };

  // navigation
  setView: (v: ViewId) => void;
  setSelectedClaim: (id: string | null) => void;
  setFilter: (k: string, v: string) => void;

  // lifecycle
  startProcessing: (stages: { id: string; label: string }[]) => void;
  updateStage: (id: string, status: string, detail?: string) => void;
  cancelProcessing: () => void;
  finishProcessing: () => void;

  createProject: (paper: PaperMeta, claims: Claim[], reported: Claim[] extends never ? never : Project["reported_metrics"], coverage: Project["coverage"]) => string;
  loadDemo: () => string;
  deleteProject: (id: string) => void;
  renameProject: (id: string, title: string) => void;

  // claims
  editClaim: (
    projectId: string,
    claimId: string,
    patch: { value?: string | number | boolean | null; unit?: string | null; evidence_status?: EvidenceStatus; impact?: Impact; note?: string },
    reason: string
  ) => void;
  setClaimReview: (projectId: string, claimId: string, status: ReviewStatus) => void;
  bulkAccept: (projectId: string, claimIds: string[]) => void;
  undoLastEdit: (projectId: string) => void;

  // plan
  generatePlan: (projectId: string, preset: PlanPreset) => void;
  setTaskStatus: (projectId: string, taskId: string, status: ProtocolTask["status"], note?: string) => void;

  // datasets
  updateDataset: (projectId: string, datasetId: string, patch: Partial<DatasetRecord>) => void;
  setLeakageCheck: (projectId: string, datasetId: string, checkId: string, state: "unknown" | "clear" | "flagged") => void;

  // compute
  computeEstimate: (projectId: string, inputs: ComputeInputs) => void;

  // scaffold
  generateScaffold: (projectId: string, framework: ScaffoldFramework, scope: ScaffoldScope) => void;
  editScaffoldFile: (projectId: string, path: string, content: string) => void;

  // validation
  validate: (projectId: string) => void;

  // runs
  importRuns: (projectId: string, runs: RunManifest[]) => void;
  addAssessment: (projectId: string, row: ComparisonRow, status: ReproductionAssessment["status"], note: string, confirmed: boolean) => void;

  // settings
  updateSettings: (patch: Partial<Settings>) => void;
}

function log(project: Project, kind: ActivityEvent["kind"], detail: string): Project {
  return {
    ...project,
    updated_at: new Date().toISOString(),
    activity: [{ at: new Date().toISOString(), kind, detail }, ...project.activity].slice(0, 100),
  };
}

const DEFAULT_SETTINGS: Settings = {
  privacy_mode: "local_only",
  extraction_engine: "heuristic",
  telemetry: false,
  export_markdown: true,
};

const PROCESSING_STAGES = [
  { id: "resolve", label: "Resolve source & identity" },
  { id: "parse", label: "Parse document & build coverage report" },
  { id: "segment", label: "Segment sections, tables & equations" },
  { id: "extract", label: "Extract candidate claims" },
  { id: "verify", label: "Verify evidence anchors" },
  { id: "schema", label: "Validate claim schema" },
  { id: "prepare", label: "Prepare review workspace" },
];

export const useP2B = create<P2BStore>()(
  persist(
    (set, get) => ({
      view: "import",
      activeProjectId: null,
      projects: {},
      settings: DEFAULT_SETTINGS,
      processing: null,
      selectedClaimId: null,
      evidenceFilters: { q: "", category: "all", status: "all", impact: "all", review: "all" },

      setView: (v) => set({ view: v }),
      setSelectedClaim: (id) => set({ selectedClaimId: id }),
      setFilter: (k, v) =>
        set((s) => ({ evidenceFilters: { ...s.evidenceFilters, [k]: v } })),

      startProcessing: (stages) =>
        set({
          processing: {
            active: true,
            stages: PROCESSING_STAGES.map((s) => ({
              ...s,
              status: "pending",
            })).map((s) =>
              stages.some((x) => x.id === s.id) ? s : s
            ),
          },
          view: "processing",
        }),
      updateStage: (id, status, detail) =>
        set((s) => {
          if (!s.processing) return s;
          return {
            processing: {
              ...s.processing,
              stages: s.processing.stages.map((st) =>
                st.id === id ? { ...st, status, detail } : st
              ),
            },
          };
        }),
      cancelProcessing: () =>
        set((s) => ({
          processing: s.processing
            ? { ...s.processing, active: false }
            : null,
          view: "import",
        })),
      finishProcessing: () => set({ processing: null }),

      createProject: (paper, claims, reported, coverage) => {
        const id = `p2b_${shortHash(paper.source_url + paper.source_version, 10)}`;
        const now = new Date().toISOString();
        const project: Project = {
          id,
          created_at: now,
          updated_at: now,
          paper,
          coverage,
          claims,
          reported_metrics: reported,
          tasks: [],
          datasets: [],
          compute: null,
          scaffold: null,
          validation: null,
          runs: [],
          assessments: [],
          activity: [
            { at: now, kind: "project_created", detail: `Project created from ${paper.source_kind}: ${paper.title}` },
            { at: now, kind: "claims_extracted", detail: `${claims.length} claims extracted (${claims.filter((c) => c.evidence_status === "reported").length} reported, ${claims.filter((c) => c.evidence_status === "unspecified").length} unspecified, ${claims.filter((c) => c.evidence_status === "conflicting").length} conflicting).` },
          ],
          provisional: false,
        };
        set((s) => ({
          projects: { ...s.projects, [id]: project },
          activeProjectId: id,
          view: "overview",
          processing: null,
          selectedClaimId: null,
        }));
        return id;
      },

      loadDemo: () => {
        const demo = buildDemoProject();
        set((s) => ({
          projects: { ...s.projects, [demo.id]: demo },
          activeProjectId: demo.id,
          view: "overview",
          processing: null,
        }));
        return demo.id;
      },

      deleteProject: (id) =>
        set((s) => {
          const projects = { ...s.projects };
          delete projects[id];
          const wasActive = s.activeProjectId === id;
          return {
            projects,
            activeProjectId: wasActive ? null : s.activeProjectId,
            view: wasActive ? "import" : s.view,
          };
        }),

      renameProject: (id, title) =>
        set((s) => {
          const p = s.projects[id];
          if (!p) return s;
          return {
            projects: {
              ...s.projects,
              [id]: log({ ...p, paper: { ...p.paper, title } }, "project_created", `Project renamed to "${title}".`),
            },
          };
        }),

      editClaim: (projectId, claimId, patch, reason) =>
        set((s) => {
          const p = s.projects[projectId];
          if (!p) return s;
          const claims = p.claims.map((c) => {
            if (c.claim_id !== claimId) return c;
            const next: Claim = {
              ...c,
              value: patch.value !== undefined ? patch.value : c.value,
              unit: patch.unit !== undefined ? patch.unit : c.unit,
              evidence_status: patch.evidence_status ?? c.evidence_status,
              impact: patch.impact ?? c.impact,
              notes: patch.note ? [...c.notes, patch.note] : c.notes,
              review_status: "corrected",
              revisions: [
                ...c.revisions,
                {
                  value: patch.value !== undefined ? patch.value : c.value,
                  evidence_status: patch.evidence_status ?? c.evidence_status,
                  actor: "user" as const,
                  at: new Date().toISOString(),
                  reason,
                },
              ],
            };
            return next;
          });
          const claim = claims.find((c) => c.claim_id === claimId);
          return {
            projects: {
              ...s.projects,
              [projectId]: log(
                { ...p, claims },
                claim?.evidence_status === "conflicting" ? "conflict_resolved" : "claim_edited",
                `\`${claimId}\` corrected → \`${String(claim?.value)}\` (${reason}). Downstream artifacts marked stale.`
              ),
            },
          };
        }),

      setClaimReview: (projectId, claimId, status) =>
        set((s) => {
          const p = s.projects[projectId];
          if (!p) return s;
          const claims = p.claims.map((c) =>
            c.claim_id === claimId ? { ...c, review_status: status } : c
          );
          return {
            projects: {
              ...s.projects,
              [projectId]: log({ ...p, claims }, status === "accepted" ? "claim_accepted" : "claim_edited", `\`${claimId}\` review status → ${status}.`),
            },
          };
        }),

      bulkAccept: (projectId, claimIds) =>
        set((s) => {
          const p = s.projects[projectId];
          if (!p) return s;
          const idSet = new Set(claimIds);
          const claims = p.claims.map((c) =>
            idSet.has(c.claim_id) ? { ...c, review_status: "accepted" as const } : c
          );
          return {
            projects: {
              ...s.projects,
              [projectId]: log({ ...p, claims }, "claim_accepted", `Bulk-accepted ${claimIds.length} low-risk reviewed claims.`),
            },
          };
        }),

      undoLastEdit: (projectId) =>
        set((s) => {
          const p = s.projects[projectId];
          if (!p) return s;
          // find most recent user revision across claims
          let target: { id: string; idx: number } | null = null;
          p.claims.forEach((c) => {
            for (let i = c.revisions.length - 1; i >= 0; i--) {
              if (c.revisions[i].actor === "user") {
                if (!target || c.revisions[i].at > p.claims.find((x) => x.claim_id === target!.id)!.revisions[target!.idx].at) {
                  target = { id: c.claim_id, idx: i };
                }
                break;
              }
            }
          });
          if (!target) return s;
          const claims = p.claims.map((c) => {
            if (c.claim_id !== target!.id) return c;
            const prev = c.revisions[target!.idx - 1] ?? c.revisions[0];
            return {
              ...c,
              value: prev.value,
              evidence_status: prev.evidence_status,
              review_status: "not_reviewed" as const,
              revisions: c.revisions.slice(0, target!.idx),
            };
          });
          return {
            projects: {
              ...s.projects,
              [projectId]: log({ ...p, claims }, "claim_edited", `Undo applied to \`${target.id}\` (session undo).`),
            },
          };
        }),

      generatePlan: (projectId, preset) =>
        set((s) => {
          const p = s.projects[projectId];
          if (!p) return s;
          const tasks = generatePlan(p.claims, preset);
          const datasets = p.datasets.length ? p.datasets : generateDatasetRecords(p.claims);
          return {
            projects: {
              ...s.projects,
              [projectId]: log({ ...p, tasks, datasets }, "plan_generated", `Reproduction plan generated (${tasks.length} tasks, preset: ${preset}).`),
            },
          };
        }),

      setTaskStatus: (projectId, taskId, status, note) =>
        set((s) => {
          const p = s.projects[projectId];
          if (!p) return s;
          const tasks = p.tasks.map((t) =>
            t.task_id === taskId ? { ...t, status, note: note ?? t.note } : t
          );
          const depTask = p.tasks.find((t) => t.task_id === taskId);
          return {
            projects: {
              ...s.projects,
              [projectId]: log({ ...p, tasks }, "task_updated", `Task "${depTask?.title ?? taskId}" → ${status}.`),
            },
          };
        }),

      updateDataset: (projectId, datasetId, patch) =>
        set((s) => {
          const p = s.projects[projectId];
          if (!p) return s;
          const datasets = p.datasets.map((d) =>
            d.dataset_id === datasetId ? { ...d, ...patch } : d
          );
          const d = datasets.find((x) => x.dataset_id === datasetId);
          return {
            projects: {
              ...s.projects,
              [projectId]: log({ ...p, datasets }, "dataset_updated", `Dataset "${d?.name}" updated (access: ${d?.access_state}, licence: ${d?.license_status}).`),
            },
          };
        }),

      setLeakageCheck: (projectId, datasetId, checkId, state) =>
        set((s) => {
          const p = s.projects[projectId];
          if (!p) return s;
          const datasets = p.datasets.map((d) =>
            d.dataset_id === datasetId
              ? {
                  ...d,
                  leakage_checks: (d.leakage_checks ?? []).map((l) =>
                    l.id === checkId ? { ...l, state } : l
                  ),
                }
              : d
          );
          return { projects: { ...s.projects, [projectId]: log({ ...p, datasets }, "dataset_updated", `Leakage check ${checkId} → ${state}.`) } };
        }),

      computeEstimate: (projectId, inputs) =>
        set((s) => {
          const p = s.projects[projectId];
          if (!p) return s;
          const est: ComputeEstimate = runCompute(inputs);
          return {
            projects: {
              ...s.projects,
              [projectId]: log({ ...p, compute: est }, "compute_estimated", `Compute estimate updated (formula ${est.formula_version}, range ${est.total_mem_gb_low}–${est.total_mem_gb_high} GB).`),
            },
          };
        }),

      generateScaffold: (projectId, framework, scope) =>
        set((s) => {
          const p = s.projects[projectId];
          if (!p) return s;
          const { config, todos } = buildConfigFromClaims(p.claims, framework);
          const files = generateScaffoldFiles(p.paper, p.claims, p.reported_metrics, p.tasks, config, todos, scope);
          const critUnresolved = p.claims.filter(
            (c) =>
              c.impact === "critical" &&
              (c.evidence_status === "unspecified" || c.evidence_status === "conflicting") &&
              c.review_status === "not_reviewed"
          );
          const existed = Boolean(p.scaffold);
          const scaffold = {
            framework,
            scope,
            generated_at: new Date().toISOString(),
            template_version: TEMPLATE_VERSION,
            spec_claim_revision: shortHash(JSON.stringify(config) + p.claims.map((c) => `${c.claim_id}:${c.value}:${c.review_status}`).join("|"), 12),
            files,
            config: config as unknown as Record<string, string | number | boolean | null>,
          };
          return {
            projects: {
              ...s.projects,
              [projectId]: log(
                { ...p, scaffold, provisional: critUnresolved.length > 0 },
                existed ? "scaffold_regenerated" : "scaffold_generated",
                `${existed ? "Regenerated" : "Generated"} ${files.length} files (${framework} template, scope ${scope}). ${critUnresolved.length} unresolved critical claim(s) — project marked provisional.`
              ),
            },
          };
        }),

      editScaffoldFile: (projectId, path, content) =>
        set((s) => {
          const p = s.projects[projectId];
          if (!p?.scaffold) return s;
          const files = p.scaffold.files.map((f) =>
            f.path === path ? { ...f, content, status: "user_modified" as const, user_modified: true, stale: false } : f
          );
          return {
            projects: {
              ...s.projects,
              [projectId]: log({ ...p, scaffold: { ...p.scaffold, files } }, "file_edited", `\`${path}\` edited by user — regeneration will show a diff, never overwrite silently.`),
            },
          };
        }),

      validate: (projectId) =>
        set((s) => {
          const p = s.projects[projectId];
          if (!p) return s;
          const checks = runValidation(p);
          const files = p.scaffold
            ? p.scaffold.files.map((f) => ({
                ...f,
                status: f.status === "user_modified" ? f.status : ("validated" as const),
              }))
            : null;
          return {
            projects: {
              ...s.projects,
              [projectId]: log(
                { ...p, validation: { ran_at: new Date().toISOString(), checks }, scaffold: files ? { ...p.scaffold!, files } : p.scaffold },
                "validation_run",
                `Validation ran: ${checks.filter((c) => c.result === "pass").length} pass, ${checks.filter((c) => c.result === "warning").length} warning, ${checks.filter((c) => c.result === "fail").length} fail, ${checks.filter((c) => c.result === "blocked").length} blocked, ${checks.filter((c) => c.result === "skipped").length} skipped.`
              ),
            },
          };
        }),

      importRuns: (projectId, runs) =>
        set((s) => {
          const p = s.projects[projectId];
          if (!p) return s;
          const existing = new Set(p.runs.map((r) => r.run_id));
          const fresh = runs.filter((r) => !existing.has(r.run_id));
          return {
            projects: {
              ...s.projects,
              [projectId]: log({ ...p, runs: [...p.runs, ...fresh] }, "run_imported", `Imported ${fresh.length} run manifest(s)${runs.length - fresh.length ? `, ${runs.length - fresh.length} duplicate(s) skipped` : ""}.`),
            },
          };
        }),

      addAssessment: (projectId, row, status, note, confirmed) =>
        set((s) => {
          const p = s.projects[projectId];
          if (!p) return s;
          const a = makeAssessment(row, status, note, confirmed);
          const assessments = [
            ...p.assessments.filter((x) => x.assessment_id !== a.assessment_id),
            a,
          ];
          return {
            projects: {
              ...s.projects,
              [projectId]: log({ ...p, assessments }, "assessment_updated", `${row.metric} vs ${row.run_id ?? "—"} assessed as "${status}"${confirmed ? " (protocol confirmed by user)" : ""}.`),
            },
          };
        }),

      updateSettings: (patch) =>
        set((s) => {
          const settings = { ...s.settings, ...patch };
          void get;
          return { settings };
        }),
    }),
    {
      name: "paper2bench-store-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        projects: s.projects,
        activeProjectId: s.activeProjectId,
        settings: s.settings,
        view: s.view === "processing" ? "import" : s.view,
      }),
    }
  )
);

export function defaultInputsFor(project: Project): ComputeInputs {
  return defaultComputeInputs(project.claims);
}

export function scaffoldConfigOf(project: Project): ScaffoldConfig | null {
  return project.scaffold ? (project.scaffold.config as unknown as ScaffoldConfig) : null;
}
