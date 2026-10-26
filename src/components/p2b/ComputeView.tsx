"use client";

import { useMemo, useState } from "react";
import { useP2B, defaultInputsFor } from "@/lib/p2b/store";
import type { ComputeInputs } from "@/lib/p2b/planner";
import { SectionHeading, EmptyState } from "./bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Calculator, Cpu, HardDrive, Timer } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { fmtHours } from "./format";

/** Screen H — compute estimate: ranges + assumptions + missing inputs. Never "measured". */
export function ComputeView() {
  const project = useP2B((s) => (s.activeProjectId ? s.projects[s.activeProjectId] : null));
  const computeEstimate = useP2B((s) => s.computeEstimate);
  const defaults = useMemo(() => (project ? defaultInputsFor(project) : null), [project]);
  const [inp, setInp] = useState<ComputeInputs | null>(defaults);

  if (!project || !inp) return null;

  const set = (k: keyof ComputeInputs, v: ComputeInputs[keyof ComputeInputs]) =>
    setInp((s) => (s ? { ...s, [k]: v } : s));

  const est = project.compute;

  const run = () => {
    computeEstimate(project.id, inp);
    toast({
      title: "Estimate computed",
      description: "This is a documented range, not a measurement. Profile one real step to refine it.",
    });
  };

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Compute estimate"
        desc="Transparent formula with versioned heuristics. The estimate is a range with assumptions attached — never labelled as measured."
      />

      <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
        {/* Inputs */}
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
            <Calculator className="h-4 w-4 text-primary" /> Inputs
            <span className="ml-auto text-[11px] font-normal text-muted-foreground">
              prefilled from claims where known
            </span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Params (millions)" value={inp.params_millions} onChange={(v) => set("params_millions", v)} />
            <div>
              <Label className="text-[12px]">Precision</Label>
              <Select value={inp.dtype} onValueChange={(v) => set("dtype", v as ComputeInputs["dtype"])}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fp32">fp32</SelectItem>
                  <SelectItem value="fp16">fp16</SelectItem>
                  <SelectItem value="bf16">bf16</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <NumField label="Sequence / resolution" value={inp.seq_len} onChange={(v) => set("seq_len", v)} />
            <NumField label="Batch size" value={inp.batch_size} onChange={(v) => set("batch_size", v)} />
            <div>
              <Label className="text-[12px]">Batch unit</Label>
              <Select
                value={inp.batch_is_tokens ? "tokens" : "examples"}
                onValueChange={(v) => set("batch_is_tokens", v === "tokens")}
              >
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tokens">Tokens / step</SelectItem>
                  <SelectItem value="examples">Examples / step</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <NumField
              label={inp.batch_is_tokens ? "Avg tokens / example" : "(n/a — example batch)"}
              value={inp.avg_tokens_per_example}
              onChange={(v) => set("avg_tokens_per_example", v)}
            />
            <NumField label="Grad accumulation" value={inp.grad_accum} onChange={(v) => set("grad_accum", v)} />
            <NumField label="Epochs" value={inp.epochs} onChange={(v) => set("epochs", v)} />
            <NumField label="Dataset examples" value={inp.dataset_examples} onChange={(v) => set("dataset_examples", v)} />
            <NumField label="Seeds" value={inp.seeds} onChange={(v) => set("seeds", v)} />
            <div>
              <Label className="text-[12px]">Optimizer</Label>
              <Select value={inp.optimizer} onValueChange={(v) => set("optimizer", v as ComputeInputs["optimizer"])}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="adamw">AdamW</SelectItem>
                  <SelectItem value="adam">Adam</SelectItem>
                  <SelectItem value="sgd">SGD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[12px]">Accelerator</Label>
              <Select value={inp.accelerator} onValueChange={(v) => set("accelerator", v)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="a100">A100-40GB</SelectItem>
                  <SelectItem value="h100">H100-80GB</SelectItem>
                  <SelectItem value="v100">V100-16GB</SelectItem>
                  <SelectItem value="p100">P100-16GB</SelectItem>
                  <SelectItem value="t4">T4-16GB</SelectItem>
                  <SelectItem value="cpu">CPU (very slow)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/60 p-3">
            <div>
              <Label className="text-[12.5px]">Gradient checkpointing</Label>
              <p className="text-[11px] text-muted-foreground">trades ~30% speed for much less activation memory</p>
            </div>
            <Switch checked={inp.grad_checkpointing} onCheckedChange={(v) => set("grad_checkpointing", v)} aria-label="Gradient checkpointing" />
          </div>
          <Button onClick={run} className="mt-4 w-full gap-2">
            <Calculator className="h-4 w-4" /> Compute estimate
          </Button>
        </div>

        {/* Results */}
        <div className="space-y-4">
          {!est ? (
            <EmptyState
              icon={<Cpu className="h-8 w-8" />}
              title="No estimate yet"
              hint="Fill the inputs (they are prefilled from extracted claims where possible) and compute. You will get ranges, formulas and the most influential missing fields — not a single fake-precise number."
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <EstCard
                  icon={<Cpu className="h-4 w-4" />}
                  label="Peak memory (range)"
                  value={`${est.total_mem_gb_low} – ${est.total_mem_gb_high} GB`}
                  sub={`weights ${est.model_mem_gb} + optimizer ${est.optimizer_mem_gb} + grads ${est.grad_mem_gb} + activations ${est.activation_mem_gb_low}–${est.activation_mem_gb_high}`}
                />
                <EstCard
                  icon={<Timer className="h-4 w-4" />}
                  label={`Runtime (range, ${est.seeds} seed${est.seeds > 1 ? "s" : ""})`}
                  value={`${fmtHours(est.runtime_hours_low)} – ${fmtHours(est.runtime_hours_high)}`}
                  sub={`${est.train_steps.toLocaleString()} optimizer steps (from epochs × dataset ÷ effective batch)`}
                />
                <EstCard
                  icon={<HardDrive className="h-4 w-4" />}
                  label="Storage estimate"
                  value={`${est.storage_gb} GB`}
                  sub="dataset + 2 checkpoints (weights+optimizer) + logs headroom"
                />
              </div>

              <div className="rounded-xl border border-amber-warm/50 bg-[color-mix(in_srgb,var(--amber-warm)_9%,transparent)] p-4">
                <p className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold text-[var(--warning)]">
                  <AlertTriangle className="h-4 w-4" /> Estimate — NOT measured
                </p>
                <p className="text-[12.5px] leading-relaxed text-foreground/85">
                  Formula version <code className="font-mono">{est.formula_version}</code>, computed{" "}
                  {new Date(est.computed_at).toLocaleString()}. Refine by profiling one real step and
                  replacing the throughput heuristic.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Assumptions (stored with the estimate)
                  </p>
                  <ul className="list-disc space-y-1.5 pl-4 text-[12.5px] leading-relaxed">
                    {est.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-destructive/35 bg-destructive/5 p-4">
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-destructive">
                    Missing inputs that materially move this number
                  </p>
                  <ul className="list-disc space-y-1.5 pl-4 text-[12.5px] leading-relaxed">
                    {est.missing_inputs.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <Label htmlFor={`ci-${label}`} className="text-[12px]">
        {label}
      </Label>
      <Input
        id={`ci-${label}`}
        type="number"
        value={value}
        min={0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="mt-1 h-9"
      />
    </div>
  );
}

function EstCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-[11.5px] uppercase tracking-wide text-muted-foreground">
        <span className="text-primary">{icon}</span> {label}
      </p>
      <p className="mt-1.5 font-display text-[19px] font-semibold">{value}</p>
      <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{sub}</p>
    </div>
  );
}
