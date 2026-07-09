"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Topbar } from "@/components/topbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Upload } from "lucide-react";
import { api } from "@/lib/api";
import { resumeHtmlDocument } from "@/lib/resume-render";
import type {
  LabConfig,
  LabModel,
  LabResult,
  LabStageName,
  LabStageConfig,
  LabStep,
  LabUsage,
} from "@/lib/types";

// Local mirror of the API's model-id → provider heuristic, for the little
// provider tag next to a free-typed model id (backend owns the real dispatch).
function providerOf(models: LabModel[], id: string): "anthropic" | "openai" | "custom" {
  const known = models.find((m) => m.id === id);
  if (known) return known.provider;
  if (/^(gpt-|o[1-9]|chatgpt-|text-)/i.test(id)) return "openai";
  return "custom";
}

// Cost ESTIMATE (USD) from the model's list prices — approximate, display-only.
// Unknown model ids (free-typed) return null and are excluded from totals.
function estCost(models: LabModel[], id: string, u: LabUsage): number | null {
  const m = models.find((x) => x.id === id);
  if (!m) return null;
  return (u.inputTokens * m.inPricePerM + u.outputTokens * m.outPricePerM) / 1_000_000;
}

const STAGE_TONE: Record<LabStageName, "info" | "success" | "warning" | "neutral"> = {
  planner: "info",
  generator: "success",
  verifier: "warning",
  revise: "neutral",
};

const fmtCost = (n: number) => `$${n.toFixed(4)}`;
const fmtTokens = (u: LabUsage) => `${u.inputTokens.toLocaleString()} → ${u.outputTokens.toLocaleString()} tok`;

export default function TailorLabPage() {
  const [config, setConfig] = useState<LabConfig | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // inputs
  const [master, setMaster] = useState("");
  const [jobText, setJobText] = useState("");
  const [summary, setSummary] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);

  // per-stage config
  const [plannerOn, setPlannerOn] = useState(false);
  const [planner, setPlanner] = useState<LabStageConfig>({ model: "", system: "" });
  const [generator, setGenerator] = useState<LabStageConfig>({ model: "", system: "" });
  const [verifier, setVerifier] = useState<LabStageConfig>({ model: "", system: "" });
  const [maxIterations, setMaxIterations] = useState(2);
  const [maxOutputTokens, setMaxOutputTokens] = useState(8000);

  // run state
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<LabResult | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .tailorLabConfig()
      .then((cfg) => {
        setConfig(cfg);
        setPlannerOn(cfg.defaults.plannerEnabled);
        setPlanner(cfg.defaults.planner);
        setGenerator(cfg.defaults.generator);
        setVerifier(cfg.defaults.verifier);
        setMaxIterations(cfg.defaults.maxIterations);
        setMaxOutputTokens(cfg.defaults.maxOutputTokens);
      })
      .catch((e: Error) => setLoadErr(e.message));
  }, []);

  // Live elapsed timer while a (long) run is in flight.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (running) {
      const started = performance.now();
      timerRef.current = setInterval(() => setElapsed(Math.round((performance.now() - started) / 1000)), 250);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [running]);

  function loadSample() {
    if (!config) return;
    setMaster(config.sample.master);
    setJobText(config.sample.jobText);
    setSummary(config.sample.candidateSummary);
  }

  async function onPickResume(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setUploading(true);
    setUploadNote(null);
    try {
      const res = await api.parseTailorLabResume(file);
      setMaster(res.text);
      setUploadNote(
        `Loaded ${res.name} (${res.kind}, ${res.text.length.toLocaleString()} chars). Tidy it into Markdown headings (# Name, ## SECTION) for the best tailoring output.`,
      );
    } catch (err) {
      setUploadNote(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  function resetPrompts() {
    if (!config) return;
    setPlannerOn(config.defaults.plannerEnabled);
    setPlanner(config.defaults.planner);
    setGenerator(config.defaults.generator);
    setVerifier(config.defaults.verifier);
    setMaxIterations(config.defaults.maxIterations);
  }

  async function run() {
    if (!master.trim() || !jobText.trim()) {
      setRunErr("Paste a master résumé and a job description first.");
      return;
    }
    setRunning(true);
    setRunErr(null);
    setResult(null);
    setElapsed(0);
    try {
      const res = await api.runTailorLab({
        master,
        jobText,
        candidateSummary: summary,
        maxIterations,
        maxOutputTokens,
        planner: plannerOn ? planner : null,
        generator,
        verifier,
      });
      setResult(res);
      if (res.error) setRunErr(res.error);
    } catch (e) {
      setRunErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const models = config?.models ?? [];

  const totals = useMemo(() => {
    if (!result) return null;
    let cost = 0;
    let hadUnknown = false;
    for (const s of result.steps) {
      const c = estCost(models, s.model, s.usage);
      if (c == null) hadUnknown = true;
      else cost += c;
    }
    return { cost, hadUnknown };
  }, [result, models]);

  return (
    <>
      <Topbar title="Tailor Lab" />
      <div className="mx-auto max-w-6xl px-8 pb-20">
        <div className="mb-5">
          <h1 className="font-heading text-2xl font-bold tracking-tight">Résumé Tailoring Lab</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            A/B different prompts and model combinations across the{" "}
            <b>planner → generator → verifier</b> pipeline. Prompts default to the shipped production
            baseline; edit any of them, pick a model per stage, and run to see every intermediate
            artifact with latency, tokens, and an estimated cost.
          </p>
        </div>

        {loadErr && <p className="mb-4 text-sm text-destructive">Couldn’t load lab: {loadErr}</p>}

        {config && !config.hasAnthropic && (
          <Card className="mb-4 border-warning/40 px-4 py-3">
            <p className="text-sm text-warning">
              No <code>ANTHROPIC_API_KEY</code> on the Worker — Claude stages will error. OpenAI
              stages need <code>OPENAI_API_KEY</code>
              {config.hasOpenai ? " (present)" : " (also missing)"}.
            </p>
          </Card>
        )}

        {/* ── Inputs ─────────────────────────────────────────────── */}
        <Card className="mb-5 px-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              Inputs
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.txt,.md,application/pdf"
                className="hidden"
                onChange={onPickResume}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="mr-1.5 size-3.5" />
                {uploading ? "Parsing…" : "Upload résumé"}
              </Button>
              <Button size="sm" variant="outline" onClick={loadSample} disabled={!config}>
                Load sample
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setMaster("");
                  setJobText("");
                  setSummary("");
                  setUploadNote(null);
                }}
              >
                Clear
              </Button>
            </div>
          </div>
          {uploadNote && (
            <p
              className={`mb-3 text-xs ${
                uploadNote.startsWith("Upload failed") ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {uploadNote}
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Field label={`Master résumé (Markdown) · ${master.trim() ? master.trim().split(/\s+/).length : 0} words`}>
              <Textarea
                rows={14}
                value={master}
                onChange={(e) => setMaster(e.target.value)}
                placeholder="# Full Name&#10;Location | Phone | email …&#10;&#10;## SUMMARY …"
                className="font-mono text-xs leading-relaxed"
              />
            </Field>
            <div className="flex flex-col gap-4">
              <Field label="Job description">
                <Textarea
                  rows={9}
                  value={jobText}
                  onChange={(e) => setJobText(e.target.value)}
                  placeholder="Paste the target job posting…"
                  className="text-xs leading-relaxed"
                />
              </Field>
              <Field label="Candidate summary (optional)">
                <Textarea
                  rows={3}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="One-line précis of the candidate (feeds planner + generator)…"
                  className="text-xs leading-relaxed"
                />
              </Field>
            </div>
          </div>
        </Card>

        {/* ── Pipeline config ────────────────────────────────────── */}
        <div className="mb-3 flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            Pipeline
          </div>
          <Button size="sm" variant="ghost" onClick={resetPrompts} disabled={!config}>
            Reset prompts to production
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <StageCard
            title="Planner"
            tone="info"
            models={models}
            stage={planner}
            onChange={setPlanner}
            enabled={plannerOn}
            onToggle={setPlannerOn}
            hint="Produces a tailoring strategy the generator follows. Optional — off matches production."
          />
          <StageCard
            title="Generator"
            tone="success"
            models={models}
            stage={generator}
            onChange={setGenerator}
            hint="Writes (and revises) the tailored résumé Markdown."
          />
          <StageCard
            title="Verifier"
            tone="warning"
            models={models}
            stage={verifier}
            onChange={setVerifier}
            hint="Critiques the draft → {pass, issues}. Fails trigger a revise."
          />
        </div>

        {/* ── Run bar ────────────────────────────────────────────── */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Max revise iterations
            <select
              value={maxIterations}
              onChange={(e) => setMaxIterations(Number(e.target.value))}
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            >
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Max output tokens
            <input
              type="number"
              min={1000}
              max={32000}
              step={1000}
              value={maxOutputTokens}
              onChange={(e) => setMaxOutputTokens(Number(e.target.value) || 8000)}
              className="h-8 w-24 rounded-lg border border-input bg-transparent px-2 text-sm tabular-nums"
              title="Output cap for the generator/revise calls. Raise it if long résumés come back cut off."
            />
          </label>
          <Button onClick={() => void run()} disabled={running || !config}>
            {running ? `Running… ${elapsed}s` : "Run pipeline"}
          </Button>
          {runErr && <span className="text-sm text-destructive">{runErr}</span>}
        </div>

        {/* ── Results ────────────────────────────────────────────── */}
        {result && (
          <div className="mt-8">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-2 font-heading text-lg font-semibold">Run trace</h2>
              <Chip tone="neutral">{(result.totalMs / 1000).toFixed(1)}s total</Chip>
              <Chip tone="neutral">{fmtTokens(result.usage)}</Chip>
              {totals && (
                <Chip tone="info">
                  ≈ {fmtCost(totals.cost)}
                  {totals.hadUnknown ? "＋" : ""} est.
                </Chip>
              )}
              <Chip tone="neutral">{result.iterations} revise iters</Chip>
            </div>

            <div className="flex flex-col gap-3">
              {result.steps.map((s, i) => (
                <StepCard key={i} step={s} models={models} />
              ))}
            </div>

            {result.final && <FinalResume markdown={result.final} />}
          </div>
        )}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: LabModel[];
  value: string;
  onChange: (v: string) => void;
}) {
  const known = models.some((m) => m.id === value);
  const provider = providerOf(models, value);
  const anthropic = models.filter((m) => m.provider === "anthropic");
  const openai = models.filter((m) => m.provider === "openai");
  return (
    <div className="flex flex-col gap-1.5">
      {/* Quick-pick dropdown of known models; "Custom / other…" leaves the value
          to the free-text field below so ANY model id can be run. */}
      <div className="flex items-center gap-2">
        <select
          value={known ? value : "__custom__"}
          onChange={(e) => {
            if (e.target.value !== "__custom__") onChange(e.target.value);
          }}
          className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2 text-xs"
        >
          {anthropic.length > 0 && (
            <optgroup label="Anthropic">
              {anthropic.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          )}
          {openai.length > 0 && (
            <optgroup label="OpenAI">
              {openai.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          )}
          <option value="__custom__">Custom / other…</option>
        </select>
        <Chip tone={provider === "openai" ? "success" : provider === "anthropic" ? "info" : "neutral"}>
          {provider}
        </Chip>
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="or type any model id — e.g. claude-opus-4-8, gpt-4o, o3-mini"
        className="h-8 font-mono text-xs"
      />
    </div>
  );
}

function StageCard({
  title,
  tone,
  models,
  stage,
  onChange,
  hint,
  enabled,
  onToggle,
}: {
  title: string;
  tone: "info" | "success" | "warning";
  models: LabModel[];
  stage: LabStageConfig;
  onChange: (s: LabStageConfig) => void;
  hint: string;
  enabled?: boolean;
  onToggle?: (v: boolean) => void;
}) {
  const toggleable = onToggle !== undefined;
  const dim = toggleable && !enabled;
  return (
    <Card className="flex flex-col gap-3 px-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Chip tone={tone}>{title}</Chip>
          {toggleable && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => onToggle?.(e.target.checked)}
                className="size-3.5 accent-primary"
              />
              {enabled ? "enabled" : "disabled"}
            </label>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className={dim ? "pointer-events-none opacity-40" : ""}>
        <div className="mb-2">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">Model</div>
          <ModelPicker models={models} value={stage.model} onChange={(model) => onChange({ ...stage, model })} />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>System prompt</span>
            <span className="tabular-nums">{stage.system.length} chars</span>
          </div>
          <Textarea
            rows={10}
            value={stage.system}
            onChange={(e) => onChange({ ...stage, system: e.target.value })}
            className="font-mono text-[11px] leading-relaxed"
          />
        </div>
      </div>
    </Card>
  );
}

function StepCard({ step, models }: { step: LabStep; models: LabModel[] }) {
  const [open, setOpen] = useState(step.stage === "verifier");
  const cost = estCost(models, step.model, step.usage);
  const isResume = step.stage === "generator" || step.stage === "revise";
  return (
    <Card className="px-0 py-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">{open ? "▾" : "▸"}</span>
          <Chip tone={STAGE_TONE[step.stage]}>{step.stage}</Chip>
          {step.stage === "verifier" && (
            <Chip tone={step.pass ? "success" : "danger"}>{step.pass ? "pass" : "fail"}</Chip>
          )}
          {(step.stage === "verifier" || step.stage === "revise") && step.iteration > 0 && (
            <span className="text-xs text-muted-foreground">iter {step.iteration}</span>
          )}
          <span className="truncate font-mono text-xs text-muted-foreground">{step.model}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">{(step.ms / 1000).toFixed(1)}s</span>
          <span className="tabular-nums">{fmtTokens(step.usage)}</span>
          {cost != null && <span className="tabular-nums">{fmtCost(cost)}</span>}
        </div>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3">
          {step.error && (
            <p className="mb-2 text-sm text-destructive">Stage error: {step.error}</p>
          )}
          {step.stage === "verifier" && (step.issues?.length ?? 0) > 0 && (
            <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {step.issues!.map((iss, i) => (
                <li key={i}>{iss}</li>
              ))}
            </ul>
          )}
          <pre
            className={`max-h-[420px] overflow-auto whitespace-pre-wrap break-words border border-border bg-muted/30 p-3 text-xs leading-relaxed ${
              isResume ? "font-mono" : ""
            }`}
          >
            {step.output || "(empty)"}
          </pre>
        </div>
      )}
    </Card>
  );
}

function FinalResume({ markdown }: { markdown: string }) {
  const [view, setView] = useState<"preview" | "markdown">("preview");
  const [copied, setCopied] = useState(false);

  // Print-to-PDF via the shared résumé renderer — byte-identical to the preview
  // iframe, same approach as the tailored-résumé drawer.
  function downloadPdf() {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(resumeHtmlDocument(markdown, { title: "Tailored résumé", autoPrint: true }));
    w.document.close();
  }

  function downloadMarkdown() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tailored-resume.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold">Final résumé</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            {(["preview", "markdown"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  view === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={downloadPdf}>
            Download PDF
          </Button>
          <Button size="sm" variant="outline" onClick={downloadMarkdown}>
            Download .md
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(markdown).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied ✓" : "Copy Markdown"}
          </Button>
        </div>
      </div>
      {view === "preview" ? (
        <iframe
          title="Final résumé preview"
          srcDoc={resumeHtmlDocument(markdown, { title: "Tailored résumé" })}
          className="h-[720px] w-full border border-border bg-white"
        />
      ) : (
        <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap break-words border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed">
          {markdown}
        </pre>
      )}
    </div>
  );
}
