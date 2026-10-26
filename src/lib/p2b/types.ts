/**
 * Paper2Bench — core data contracts.
 * Derived from the Paper2Bench product blueprint (section 07: Evidence model and data contracts).
 * All persisted state is local-first: nothing here leaves the browser unless the user
 * explicitly opts into remote extraction.
 */

export type EvidenceStatus =
  | "reported"
  | "derived"
  | "inferred"
  | "unspecified"
  | "conflicting"
  | "user_confirmed"
  | "not_applicable";

export type ReviewStatus = "not_reviewed" | "accepted" | "corrected" | "escalated";

export type Impact = "critical" | "important" | "informational";

export type ClaimCategory =
  | "architecture"
  | "dataset"
  | "preprocessing"
  | "loss"
  | "optimizer"
  | "training"
  | "evaluation"
  | "metrics"
  | "compute"
  | "environment"
  | "reported_results";

export type AnchorValidity = "verified" | "weak" | "unverified";

export interface EvidenceSpan {
  evidence_id: string;
  page?: number | null;
  section?: string | null;
  locator?: string | null; // e.g. "Table 2", "Equation (3)", "Figure 1"
  text: string;
  anchor_validity: AnchorValidity;
}

export interface ClaimRevision {
  value: string | number | boolean | null;
  evidence_status: EvidenceStatus;
  actor: "extractor" | "user" | "system";
  at: string; // ISO-8601
  reason?: string;
}

export interface Claim {
  claim_id: string; // stable dotted path e.g. training.learning_rate
  category: ClaimCategory;
  field_path: string;
  label: string;
  raw_value?: string | null;
  value: string | number | boolean | null;
  unit: string | null;
  evidence_status: EvidenceStatus;
  impact: Impact;
  confidence: number; // extraction confidence 0..1 — never substitutes for evidence status
  review_status: ReviewStatus;
  notes: string[];
  evidence: EvidenceSpan[];
  revisions: ClaimRevision[];
  extractor: "heuristic" | "llm" | "demo" | "user";
}

export type MetricDirection = "maximize" | "minimize";

export interface ReportedMetric {
  metric_id: string;
  name: string;
  value: number;
  unit?: string | null;
  dataset?: string | null;
  split?: string | null;
  direction: MetricDirection;
  aggregation: string; // "single run" | "mean of N" | "best of N" | ...
  source: string; // "Table 2, row: Transformer big"
  evidence?: EvidenceSpan[];
  variability?: string | null; // e.g. "±0.2 over 3 seeds"
}

export interface RunMetric {
  name: string;
  value: number;
  split?: string | null;
  metric_version?: string | null;
}

export interface RunHistoryPoint {
  step: number;
  value: number;
}

export interface RunManifest {
  run_id: string;
  label?: string | null;
  paper_id?: string | null;
  code_commit?: string | null;
  config_hash?: string | null;
  dataset_fingerprint?: string | null;
  seed?: number | null;
  environment?: Record<string, string>;
  hardware?: Record<string, string>;
  metrics: RunMetric[];
  artifacts?: string[];
  history?: Record<string, RunHistoryPoint[]>;
  started_at?: string | null;
  finished_at?: string | null;
  source: "imported_jsonl" | "imported_csv" | "manual" | "mlflow" | "demo";
  is_example?: boolean; // demo/illustrative runs must never masquerade as real executions
}

export type TaskStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "needs_review"
  | "done"
  | "not_applicable";

export interface ProtocolTask {
  task_id: string;
  title: string;
  phase:
    | "data"
    | "environment"
    | "model"
    | "loss"
    | "training"
    | "evaluation"
    | "comparison"
    | "report";
  description: string;
  status: TaskStatus;
  dependencies: string[];
  claim_refs: string[];
  acceptance_criteria: string;
  effort: "S" | "M" | "L";
  risk: "low" | "medium" | "high";
  owner?: string | null;
  note?: string | null;
}

export type DatasetAccessState =
  | "mentioned"
  | "linked"
  | "access_verified"
  | "downloaded"
  | "fingerprinted"
  | "preprocessed";

export type LicenseStatus =
  | "identified"
  | "unknown"
  | "restricted"
  | "permissive"
  | "not_applicable";

export interface DatasetRecord {
  dataset_id: string;
  name: string;
  version?: string | null;
  source_url?: string | null;
  license_status: LicenseStatus;
  license_note?: string | null;
  splits?: string | null;
  split_provenance?: "paper_specified" | "unknown" | "custom_risk";
  preprocessing?: string | null;
  access_state: DatasetAccessState;
  fingerprint?: string | null;
  access_confirmed_by_user?: boolean;
  leakage_checks?: { id: string; label: string; state: "unknown" | "clear" | "flagged" }[];
  claim_refs: string[];
  evidence?: EvidenceSpan[];
}

export interface ComputeEstimate {
  // inputs
  params_millions: number;
  dtype: "fp32" | "fp16" | "bf16";
  seq_len: number;
  batch_size: number;
  grad_accum: number;
  epochs: number;
  dataset_examples: number;
  seeds: number;
  grad_checkpointing: boolean;
  optimizer: "adamw" | "adam" | "sgd";
  accelerator: string;
  val_fraction: number;
  // derived
  model_mem_gb: number;
  optimizer_mem_gb: number;
  grad_mem_gb: number;
  activation_mem_gb_low: number;
  activation_mem_gb_high: number;
  total_mem_gb_low: number;
  total_mem_gb_high: number;
  storage_gb: number;
  runtime_hours_low: number;
  runtime_hours_high: number;
  train_steps: number;
  assumptions: string[];
  missing_inputs: string[];
  formula_version: string;
  computed_at: string;
}

export type FileStatus =
  | "generated"
  | "template"
  | "needs_implementation"
  | "validated"
  | "user_modified";

export interface GeneratedFile {
  path: string;
  content: string;
  status: FileStatus;
  claim_refs?: string[];
  stale?: boolean;
  user_modified?: boolean;
}

export type CheckResult =
  | "pass"
  | "warning"
  | "fail"
  | "skipped"
  | "blocked"
  | "stale";

export interface ValidationCheck {
  check_id: string;
  group:
    | "configuration"
    | "static"
    | "environment"
    | "tests"
    | "smoke"
    | "data"
    | "end-to-end";
  name: string;
  result: CheckResult;
  detail: string;
  proves: string;
  does_not_prove: string;
  at?: string;
}

export interface ParseCoverage {
  parser: string;
  pages: number;
  sections_detected: string[];
  tables_detected: number;
  equations_detected: number;
  image_only_pages: number[];
  warnings: string[];
  coverage_pct: number;
}

export interface ActivityEvent {
  at: string;
  kind:
    | "project_created"
    | "claims_extracted"
    | "claim_edited"
    | "claim_accepted"
    | "conflict_resolved"
    | "plan_generated"
    | "task_updated"
    | "dataset_updated"
    | "compute_estimated"
    | "scaffold_generated"
    | "scaffold_regenerated"
    | "file_edited"
    | "validation_run"
    | "run_imported"
    | "run_added"
    | "assessment_updated"
    | "export_created"
    | "settings_changed";
  detail: string;
}

export type SourceKind = "arxiv" | "doi" | "pdf" | "demo";

export interface PaperMeta {
  paper_id: string;
  title: string;
  authors: string[];
  year?: number | null;
  venue?: string | null;
  source_url: string;
  source_kind: SourceKind;
  source_version: string; // content hash / short id
  retrieved_at: string;
  abstract?: string | null;
  full_text_available: boolean;
  extraction_scope: "abstract_only" | "full_text" | "full_text_llm" | "curated_demo";
}

export type ScaffoldFramework = "pytorch" | "huggingface";
export type ScaffoldScope = "minimal" | "baseline_target" | "with_ablations";

export interface ScaffoldState {
  framework: ScaffoldFramework;
  scope: ScaffoldScope;
  generated_at: string;
  template_version: string;
  spec_claim_revision: string; // fingerprint of reviewed claims used
  files: GeneratedFile[];
  config: Record<string, string | number | boolean | null>;
}

export interface ValidationState {
  ran_at: string;
  checks: ValidationCheck[];
}

export type ReproductionState =
  | "not_run"
  | "run_recorded"
  | "partial_reproduction"
  | "needs_verification"
  | "discrepancy_observed"
  | "criteria_passed"
  | "blocked";

export interface ReproductionAssessment {
  assessment_id: string;
  reported_metric_id: string;
  run_id: string | null;
  status: ReproductionState;
  abs_delta?: number | null;
  rel_delta?: number | null;
  rel_delta_meaningful: boolean;
  mismatches: string[];
  reviewer_note?: string | null;
  criteria_confirmed_by_user?: boolean;
  updated_at: string;
}

export interface Project {
  id: string;
  created_at: string;
  updated_at: string;
  paper: PaperMeta;
  coverage: ParseCoverage | null;
  claims: Claim[];
  reported_metrics: ReportedMetric[];
  tasks: ProtocolTask[];
  datasets: DatasetRecord[];
  compute: ComputeEstimate | null;
  scaffold: ScaffoldState | null;
  validation: ValidationState | null;
  runs: RunManifest[];
  assessments: ReproductionAssessment[];
  activity: ActivityEvent[];
  provisional: boolean; // true when generated with unresolved critical items
}

export type ViewId =
  | "import"
  | "processing"
  | "overview"
  | "evidence"
  | "plan"
  | "datasets"
  | "compute"
  | "files"
  | "validation"
  | "runs"
  | "sweeps"
  | "export"
  | "settings";

export type PrivacyMode = "local_only" | "remote_optin";
export type ExtractionEngine = "heuristic" | "llm";

export interface Settings {
  privacy_mode: PrivacyMode;
  extraction_engine: ExtractionEngine;
  telemetry: boolean;
  export_markdown: boolean;
}

export interface ProcessingStage {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  detail?: string;
}
