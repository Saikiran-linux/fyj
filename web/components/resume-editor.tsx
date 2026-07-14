"use client";

/**
 * Résumé block editor (f-156) — the PlateKit canvas ported from the prototype
 * (dash-tailor.jsx PlateEditorDirection / dash-write.jsx PeBlockCanvas) onto
 * this app's real stack: typed blocks (lib/resume-doc), Tailwind + design
 * tokens, and REAL AI line transforms via POST /api/resumes/ai (the prototype
 * used canned string rewrites).
 *
 * Interactions kept from the prototype: contentEditable rows with a hover
 * gutter (add / drag-reorder), Enter/Backspace block management, "/" slash
 * menu (turn into text/heading/bullet/section/divider or ask AI), floating
 * selection toolbar (bold/italic/underline/code/link), per-block AI menu with
 * an accept/retry/discard preview, skills chip block, inline-editable job
 * rows, and a word-level diff view against a base snapshot.
 *
 * Deliberately not ported (recorded in progress.md): ghost-text autocomplete
 * (canned fake), margin comments (no persistence model until messaging f-158),
 * and the "Dock" chat treatment (inline AI only).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Link2, Plus, RefreshCw, Sparkles, Trash2, GripVertical, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import type { AiEditKind, ResumeBlock, ResumeDocMeta } from "@/lib/types";
import {
  htmlToText,
  textToHtml,
  uid,
  wordDiff,
} from "@/lib/resume-doc";
import { BrailleSpinner } from "@/components/primitives";
import { cn } from "@/lib/utils";

/* ---------------- menus ------------------------------------------------ */

const SLASH_ITEMS: { key: string; ic: string; label: string; sub: string; type: string; ai?: boolean }[] = [
  { key: "text", ic: "T", label: "Text", sub: "plain paragraph", type: "p" },
  { key: "heading", ic: "H", label: "Heading", sub: "subsection heading", type: "h" },
  { key: "bullet", ic: "•", label: "Bulleted item", sub: "achievement / list line", type: "bullet" },
  { key: "section", ic: "§", label: "Section label", sub: "uppercase divider heading", type: "section" },
  { key: "divider", ic: "—", label: "Divider", sub: "horizontal rule", type: "divider" },
  { key: "ai", ic: "✦", label: "Ask AI", sub: "generate or rewrite", type: "ai", ai: true },
];

export const AI_COMMANDS: { kind: AiEditKind; ic: string; label: string; sub: string }[] = [
  { kind: "improve", ic: "✦", label: "Improve writing", sub: "stronger verbs + impact" },
  { kind: "grammar", ic: "Aa", label: "Fix spelling & grammar", sub: "clean up the line" },
  { kind: "shorter", ic: "–", label: "Make shorter", sub: "tighten to essentials" },
  { kind: "longer", ic: "+", label: "Make longer", sub: "add supporting detail" },
  { kind: "simplify", ic: "≈", label: "Simplify language", sub: "plainer wording" },
  { kind: "continue", ic: "→", label: "Continue writing", sub: "extend this line" },
];

/* ---------------- small pieces ----------------------------------------- */

function DiffText({ base, value }: { base: string; value: string }) {
  const segs = wordDiff(base, value);
  return (
    <span>
      {segs.map((s, i) =>
        s.type === "eq" ? (
          <span key={i}>{s.text}</span>
        ) : s.type === "add" ? (
          <span key={i} className="rounded-sm bg-success/15 text-success">{s.text}</span>
        ) : (
          <span key={i} className="rounded-sm bg-destructive/10 text-destructive line-through opacity-70">
            {s.text}
          </span>
        ),
      )}
    </span>
  );
}

/** Inline-editable span (job title / company / dates / header meta). */
export function InlineEdit({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.innerText !== value) ref.current.innerText = value;
  }, [value]);
  return (
    <span
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      className={cn(
        "inline min-w-4 rounded-sm outline-none focus:bg-accent/60 focus:ring-1 focus:ring-ring/40",
        className,
      )}
      onInput={(e) => onChange((e.currentTarget as HTMLSpanElement).innerText)}
    />
  );
}

/** contentEditable line that seeds innerHTML only on id/epoch change so the
 *  caret survives typing (the prototype's PeEditable). */
function EditableLine({
  block,
  epoch,
  seedEpoch,
  ph,
  className,
  onInput,
  onKeyDown,
  onFocus,
}: {
  block: Extract<ResumeBlock, { html: string }>;
  epoch: number;
  seedEpoch: number;
  ph: string;
  className?: string;
  onInput: (e: React.FormEvent<HTMLDivElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== (block.html || "")) el.innerHTML = block.html || "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, epoch, seedEpoch]);
  const empty = !htmlToText(block.html);
  return (
    <div
      ref={ref}
      data-block={block.id}
      data-ph={ph}
      data-empty={empty ? "true" : "false"}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      className={cn("rd-ce min-h-[1.4em] outline-none", className)}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    />
  );
}

function SkillsBlock({
  block,
  readOnly,
  onItems,
}: {
  block: Extract<ResumeBlock, { type: "skills" }>;
  readOnly: boolean;
  onItems: (items: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const items = block.data.items;
  const add = (s: string) => {
    const t = s.trim();
    if (t && !items.some((x) => x.toLowerCase() === t.toLowerCase())) onItems([...items, t]);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-0.5">
      {items.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-0.5 text-xs font-medium"
        >
          {s}
          {!readOnly && (
            <button
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onItems(items.filter((x) => x !== s))}
              aria-label={`Remove ${s}`}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {!readOnly &&
        (open ? (
          <input
            autoFocus
            placeholder="skill name"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                add(val);
                setVal("");
              } else if (e.key === "Escape") {
                setVal("");
                setOpen(false);
              }
            }}
            onBlur={() => {
              if (val.trim()) add(val);
              setVal("");
              setOpen(false);
            }}
            className="h-6 w-28 rounded-md border border-border bg-background px-2 text-xs outline-none"
          />
        ) : (
          <button
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(true)}
          >
            <Plus className="size-3" /> Add skill
          </button>
        ))}
    </div>
  );
}

interface AiPreviewState {
  blockId: string;
  kind: AiEditKind;
  label: string;
  original: string;
  status: "loading" | "ready" | "error";
  result: string;
  prompt?: string;
}

function AiPreviewCard({
  prev,
  onAccept,
  onRetry,
  onDiscard,
}: {
  prev: AiPreviewState;
  onAccept: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="my-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
        <Sparkles className="size-3.5" /> {prev.label}
        {prev.status === "loading" && <BrailleSpinner size={12} />}
      </div>
      {prev.status === "loading" ? (
        <div className="py-1.5 text-sm text-muted-foreground">Rewriting the line…</div>
      ) : prev.status === "error" ? (
        <div className="py-1.5 text-sm text-destructive">
          The AI edit failed — try again in a moment.
        </div>
      ) : (
        <div className="py-1.5 text-sm">{prev.result}</div>
      )}
      {prev.status !== "loading" && (
        <div className="flex items-center gap-2 pt-0.5">
          {prev.status === "ready" && (
            <button
              onClick={onAccept}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/85"
            >
              <Check className="size-3" /> Accept
            </button>
          )}
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
          >
            <RefreshCw className="size-3" /> Try again
          </button>
          <button
            onClick={onDiscard}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- main canvas ------------------------------------------ */

export interface ResumeEditorAiContext {
  jobTitle?: string;
  company?: string;
  missingSkills?: string[];
}

export function ResumeBlockCanvas({
  blocks,
  onBlocksChange,
  meta,
  onMetaChange,
  seedEpoch = 0,
  showDiff = false,
  baseMap = {},
  aiContext,
  className,
}: {
  blocks: ResumeBlock[];
  onBlocksChange: (next: ResumeBlock[] | ((prev: ResumeBlock[]) => ResumeBlock[])) => void;
  meta: ResumeDocMeta;
  onMetaChange: (next: ResumeDocMeta) => void;
  /** bump to force-reseed every contentEditable (variant load / restore) */
  seedEpoch?: number;
  showDiff?: boolean;
  baseMap?: Record<string, string>;
  aiContext?: ResumeEditorAiContext;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);
  const [epochs, setEpochs] = useState<Record<string, number>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tb, setTb] = useState({ show: false, x: 0, y: 0, b: false, i: false, u: false });
  const [slash, setSlash] = useState<{ blockId: string; x: number; y: number; query: string; idx: number } | null>(null);
  const [aiMenu, setAiMenu] = useState<{ blockId: string; x: number; y: number; prompt: string } | null>(null);
  const [aiPrev, setAiPrev] = useState<AiPreviewState | null>(null);

  /* ---- block mutations ---- */
  const setBlocks = onBlocksChange;
  const setHtml = useCallback(
    (id: string, html: string) =>
      setBlocks((bs) => bs.map((b) => (b.id === id && "html" in b ? { ...b, html } : b))),
    [setBlocks],
  );
  const reseedHtml = useCallback(
    (id: string, html: string) => {
      setBlocks((bs) => bs.map((b) => (b.id === id && "html" in b ? { ...b, html } : b)));
      setEpochs((e) => ({ ...e, [id]: (e[id] ?? 0) + 1 }));
    },
    [setBlocks],
  );
  const setType = (id: string, type: "p" | "h" | "bullet" | "section") => {
    setBlocks((bs) =>
      bs.map((b) => (b.id === id && "html" in b ? { ...b, type } : b)),
    );
    setEpochs((e) => ({ ...e, [id]: (e[id] ?? 0) + 1 }));
  };
  const insertAfter = (id: string, block: ResumeBlock) =>
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const n = bs.slice();
      n.splice(i + 1, 0, block);
      return n;
    });
  const removeBlock = (id: string) => setBlocks((bs) => bs.filter((b) => b.id !== id));
  const moveBlock = (from: string, toIdx: number) =>
    setBlocks((bs) => {
      const f = bs.findIndex((b) => b.id === from);
      if (f < 0) return bs;
      const n = bs.slice();
      const [m] = n.splice(f, 1);
      n.splice(toIdx, 0, m!);
      return n;
    });
  const focusBlock = (id: string, where: "start" | "end") => {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-block="${id}"]`);
      if (!el) return;
      el.focus();
      const r = document.createRange();
      const s = window.getSelection();
      if (!s) return;
      r.selectNodeContents(el);
      r.collapse(where === "start");
      s.removeAllRanges();
      s.addRange(r);
    });
  };

  /* ---- floating selection toolbar ---- */
  useEffect(() => {
    function onSel() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setTb((t) => (t.show ? { ...t, show: false } : t));
        return;
      }
      let n: Node | null = sel.anchorNode;
      if (n && n.nodeType === 3) n = n.parentNode;
      const eln = n as HTMLElement | null;
      if (!eln || !rootRef.current || !rootRef.current.contains(eln) || !eln.closest("[data-block]")) {
        setTb((t) => (t.show ? { ...t, show: false } : t));
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      setTb({
        show: true,
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
        b: document.queryCommandState("bold"),
        i: document.queryCommandState("italic"),
        u: document.queryCommandState("underline"),
      });
    }
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  function currentCe(): HTMLElement | null {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return null;
    let n: Node | null = sel.anchorNode;
    if (n.nodeType === 3) n = n.parentNode;
    return (n as HTMLElement | null)?.closest?.("[data-block]") ?? null;
  }
  function persistCe() {
    const el = currentCe();
    if (!el) return;
    setHtml(el.getAttribute("data-block")!, el.innerHTML);
  }
  function cmd(command: string, val?: string) {
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(command, false, val);
    persistCe();
    setTb((t) => ({
      ...t,
      b: document.queryCommandState("bold"),
      i: document.queryCommandState("italic"),
      u: document.queryCommandState("underline"),
    }));
  }
  function doCode() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;
    const el = document.createElement("code");
    try {
      range.surroundContents(el);
    } catch {
      const frag = range.extractContents();
      el.appendChild(frag);
      range.insertNode(el);
    }
    sel.removeAllRanges();
    persistCe();
    setTb((t) => ({ ...t, show: false }));
  }
  function doLink() {
    const url = window.prompt("Link URL", "https://");
    if (url) cmd("createLink", url);
  }

  /* ---- AI ---- */
  const runAi = useCallback(
    async (kind: AiEditKind, blockId: string, prompt?: string) => {
      const b = blocks.find((x) => x.id === blockId);
      if (!b || !("html" in b)) return;
      const original = htmlToText(b.html);
      if (!original.trim()) return;
      const label =
        kind === "custom"
          ? prompt ?? "Custom edit"
          : AI_COMMANDS.find((c) => c.kind === kind)?.label ?? "AI edit";
      setAiPrev({ blockId, kind, label, original, status: "loading", result: "", prompt });
      setAiMenu(null);
      setSlash(null);
      setTb((t) => ({ ...t, show: false }));
      try {
        const r = await api.resumeAi({
          kind,
          text: original,
          prompt,
          context: aiContext,
        });
        setAiPrev((p) =>
          p && p.blockId === blockId ? { ...p, status: "ready", result: r.text } : p,
        );
      } catch {
        setAiPrev((p) => (p && p.blockId === blockId ? { ...p, status: "error" } : p));
      }
    },
    [blocks, aiContext],
  );
  function acceptAiPrev() {
    if (aiPrev && aiPrev.status === "ready") reseedHtml(aiPrev.blockId, textToHtml(aiPrev.result));
    setAiPrev(null);
  }

  /* ---- slash menu ---- */
  const slashItems = slash
    ? SLASH_ITEMS.filter(
        (s) =>
          !slash.query ||
          s.label.toLowerCase().includes(slash.query.toLowerCase()) ||
          s.key.includes(slash.query.toLowerCase()),
      )
    : [];
  function applySlash(item: (typeof SLASH_ITEMS)[number] | undefined, blockId: string) {
    setSlash(null);
    if (!item) return;
    if (item.type === "ai") {
      reseedHtml(blockId, "");
      const el = document.querySelector<HTMLElement>(`[data-block="${blockId}"]`);
      const rect = el?.getBoundingClientRect() ?? { left: 300, bottom: 300 };
      setAiMenu({ blockId, x: rect.left, y: rect.bottom + 6, prompt: "" });
      return;
    }
    if (item.type === "divider") {
      reseedHtml(blockId, "");
      insertAfter(blockId, { id: uid(), type: "divider" });
      return;
    }
    reseedHtml(blockId, "");
    setType(blockId, item.type as "p" | "h" | "bullet" | "section");
    focusBlock(blockId, "start");
  }

  /* ---- key handling ---- */
  function onKey(e: React.KeyboardEvent<HTMLDivElement>, block: Extract<ResumeBlock, { html: string }>) {
    const el = e.currentTarget;
    if (e.key === "/" && !slash && htmlToText(el.innerHTML) === "") {
      const rect = el.getBoundingClientRect();
      setTimeout(() => setSlash({ blockId: block.id, x: rect.left, y: rect.bottom + 6, query: "", idx: 0 }), 0);
    }
    if (slash && slash.blockId === block.id) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlash((s) => s && { ...s, idx: Math.min(slashItems.length - 1, s.idx + 1) });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlash((s) => s && { ...s, idx: Math.max(0, s.idx - 1) });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        applySlash(slashItems[slash.idx] ?? slashItems[0], block.id);
        return;
      }
      if (e.key === "Escape") {
        setSlash(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      if (slash && slash.blockId === block.id) return;
      e.preventDefault();
      const nid = uid();
      const newType = block.type === "bullet" ? "bullet" : "p";
      insertAfter(block.id, { id: nid, type: newType, html: "" });
      focusBlock(nid, "start");
      return;
    }
    if (e.key === "Backspace" && htmlToText(el.innerHTML) === "") {
      const i = blocks.findIndex((b) => b.id === block.id);
      const prev = blocks[i - 1];
      if (prev && "html" in prev) {
        e.preventDefault();
        removeBlock(block.id);
        focusBlock(prev.id, "end");
      }
      return;
    }
  }
  function onInputBlock(e: React.FormEvent<HTMLDivElement>, block: Extract<ResumeBlock, { html: string }>) {
    const el = e.currentTarget;
    setHtml(block.id, el.innerHTML);
    el.setAttribute("data-empty", htmlToText(el.innerHTML) === "" ? "true" : "false");
    if (slash && slash.blockId === block.id) {
      const txt = htmlToText(el.innerHTML);
      if (!txt.startsWith("/")) setSlash(null);
      else setSlash((s) => s && { ...s, query: txt.slice(1), idx: 0 });
    }
  }

  /* ---- rows ---- */
  function rowDragProps(block: ResumeBlock) {
    return {
      onDragStart: (e: React.DragEvent) => {
        dragId.current = block.id;
        e.dataTransfer.effectAllowed = "move";
        try {
          e.dataTransfer.setData("text/plain", block.id);
        } catch {
          /* older engines */
        }
      },
      onDragOver: (e: React.DragEvent) => {
        if (dragId.current && dragId.current !== block.id) {
          e.preventDefault();
          (e.currentTarget as HTMLElement).classList.add("rd-dropbefore");
        }
      },
      onDragLeave: (e: React.DragEvent) =>
        (e.currentTarget as HTMLElement).classList.remove("rd-dropbefore"),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).classList.remove("rd-dropbefore");
        if (dragId.current) {
          moveBlock(dragId.current, blocks.findIndex((b) => b.id === block.id));
          dragId.current = null;
        }
      },
      onDragEnd: (e: React.DragEvent) => {
        (e.currentTarget as HTMLElement).setAttribute("draggable", "false");
        dragId.current = null;
      },
    };
  }

  function Gutter({ block }: { block: ResumeBlock }) {
    return (
      <div className="rd-gutter absolute -left-14 top-0 flex h-full items-start gap-0.5 pt-0.5 opacity-0 transition-opacity">
        <button
          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Add block below"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const nid = uid();
            insertAfter(block.id, { id: nid, type: "p", html: "" });
            focusBlock(nid, "start");
          }}
        >
          <Plus className="size-4" />
        </button>
        <button
          className="grid size-6 cursor-grab place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Drag to reorder"
          onMouseDown={(e) => {
            e.preventDefault();
            (e.currentTarget.closest("[data-row]") as HTMLElement | null)?.setAttribute(
              "draggable",
              "true",
            );
          }}
        >
          <GripVertical className="size-4" />
        </button>
      </div>
    );
  }

  function renderBlock(block: ResumeBlock) {
    const dragProps = rowDragProps(block);
    const rowCls = "rd-row group relative";
    if (block.type === "divider") {
      return (
        <div key={block.id} data-row className={rowCls} {...dragProps}>
          <Gutter block={block} />
          <div className="my-2 flex items-center gap-2">
            <hr className="flex-1 border-border" />
            <button
              className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              onClick={() => removeBlock(block.id)}
              aria-label="Remove divider"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      );
    }
    if (block.type === "job") {
      return (
        <div key={block.id} data-row className={rowCls} {...dragProps}>
          <Gutter block={block} />
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <div className="min-w-0 text-sm">
              <InlineEdit
                className="font-semibold"
                value={block.data.title}
                onChange={(v) =>
                  setBlocks((bs) =>
                    bs.map((b) =>
                      b.id === block.id && b.type === "job" ? { ...b, data: { ...b.data, title: v } } : b,
                    ),
                  )
                }
              />
              <span className="text-muted-foreground"> · </span>
              <InlineEdit
                className="text-muted-foreground"
                value={block.data.company}
                onChange={(v) =>
                  setBlocks((bs) =>
                    bs.map((b) =>
                      b.id === block.id && b.type === "job" ? { ...b, data: { ...b.data, company: v } } : b,
                    ),
                  )
                }
              />
            </div>
            <InlineEdit
              className="whitespace-nowrap text-xs font-medium text-muted-foreground"
              value={block.data.when}
              onChange={(v) =>
                setBlocks((bs) =>
                  bs.map((b) =>
                    b.id === block.id && b.type === "job" ? { ...b, data: { ...b.data, when: v } } : b,
                  ),
                )
              }
            />
          </div>
        </div>
      );
    }
    if (block.type === "skills") {
      return (
        <div key={block.id} data-row className={rowCls} {...dragProps}>
          <Gutter block={block} />
          <SkillsBlock
            block={block}
            readOnly={showDiff}
            onItems={(items) =>
              setBlocks((bs) =>
                bs.map((b) => (b.id === block.id && b.type === "skills" ? { ...b, data: { items } } : b)),
              )
            }
          />
        </div>
      );
    }
    // text blocks
    const baseText = baseMap[block.id];
    const textCls =
      block.type === "section"
        ? "label mt-4 border-b border-border pb-1 text-[11px]"
        : block.type === "h"
          ? "mt-3 text-sm font-semibold"
          : block.type === "bullet"
            ? "rd-bullet relative pl-4 text-sm leading-relaxed"
            : "text-sm leading-relaxed";
    return (
      <div key={block.id} data-row className={cn(rowCls, activeId === block.id && "rd-active")} {...dragProps}>
        <Gutter block={block} />
        {showDiff && baseText != null ? (
          <div className={cn(textCls, "rd-diff")}>
            <DiffText base={baseText} value={htmlToText(block.html)} />
          </div>
        ) : (
          <EditableLine
            block={block}
            epoch={epochs[block.id] ?? 0}
            seedEpoch={seedEpoch}
            ph={
              block.type === "bullet"
                ? "Bullet…"
                : block.type === "section"
                  ? "SECTION"
                  : block.type === "h"
                    ? "Heading"
                    : "Write, or press / for blocks"
            }
            className={textCls}
            onInput={(e) => onInputBlock(e, block)}
            onKeyDown={(e) => onKey(e, block)}
            onFocus={() => setActiveId(block.id)}
          />
        )}
        {aiPrev && aiPrev.blockId === block.id && (
          <AiPreviewCard
            prev={aiPrev}
            onAccept={acceptAiPrev}
            onRetry={() => void runAi(aiPrev.kind, aiPrev.blockId, aiPrev.prompt)}
            onDiscard={() => setAiPrev(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {/* scoped editor CSS the utility classes can't express */}
      <style>{`
        .rd-ce[data-empty="true"]::before { content: attr(data-ph); color: var(--muted-foreground); opacity: .5; pointer-events: none; }
        .rd-row:hover .rd-gutter, .rd-gutter:focus-within { opacity: 1; }
        .rd-row.rd-dropbefore { box-shadow: 0 -2px 0 0 var(--primary); }
        .rd-bullet::before { content: "•"; position: absolute; left: 2px; color: var(--muted-foreground); }
        .rd-ce code { font-family: var(--font-mono, ui-monospace); font-size: .85em; background: var(--muted); padding: 0 3px; border-radius: 3px; }
        .rd-ce a { color: var(--info, #2563eb); text-decoration: underline; }
      `}</style>

      {/* résumé header (name + contact) */}
      <div className="mb-3 border-b border-border pb-3 text-center">
        <div className="font-heading text-xl font-bold">
          <InlineEdit value={meta.name} onChange={(v) => onMetaChange({ ...meta, name: v })} />
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          <InlineEdit value={meta.contact} onChange={(v) => onMetaChange({ ...meta, contact: v })} />
        </div>
      </div>

      <div className="pl-14">{blocks.map(renderBlock)}</div>

      {/* floating selection toolbar */}
      {tb.show && !showDiff && (
        <div
          className="fixed z-[120] flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg border border-border bg-card px-1 py-0.5 shadow-md"
          style={{ left: tb.x, top: tb.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button className={cn("rounded px-2 py-1 text-xs font-bold hover:bg-muted", tb.b && "bg-accent")} onClick={() => cmd("bold")} title="Bold">
            B
          </button>
          <button className={cn("rounded px-2 py-1 text-xs italic hover:bg-muted", tb.i && "bg-accent")} onClick={() => cmd("italic")} title="Italic">
            I
          </button>
          <button className={cn("rounded px-2 py-1 text-xs underline hover:bg-muted", tb.u && "bg-accent")} onClick={() => cmd("underline")} title="Underline">
            U
          </button>
          <button className="rounded px-2 py-1 font-mono text-[10px] hover:bg-muted" onClick={doCode} title="Inline code">
            {"</>"}
          </button>
          <button className="rounded px-1.5 py-1 hover:bg-muted" onClick={doLink} title="Link">
            <Link2 className="size-3.5" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <button
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-primary hover:bg-muted"
            title="Ask AI"
            onClick={() => {
              const el = currentCe();
              if (!el) return;
              const id = el.getAttribute("data-block")!;
              setActiveId(id);
              setAiMenu({ blockId: id, x: tb.x - 40, y: tb.y + 14, prompt: "" });
              setTb((t) => ({ ...t, show: false }));
            }}
          >
            <Sparkles className="size-3.5" /> Ask AI
          </button>
        </div>
      )}

      {/* slash menu */}
      {slash && (
        <div
          className="fixed z-[120] w-64 rounded-lg border border-border bg-card py-1 shadow-lg"
          style={{ left: slash.x, top: slash.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="label px-2.5 py-1 text-[10px]">Blocks{slash.query ? ` · ${slash.query}` : ""}</div>
          {slashItems.length ? (
            slashItems.map((it, i) => (
              <button
                key={it.key}
                className={cn(
                  "flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-muted",
                  i === slash.idx && "bg-muted",
                  it.ai && "text-primary",
                )}
                onClick={() => applySlash(it, slash.blockId)}
                onMouseEnter={() => setSlash((s) => s && { ...s, idx: i })}
              >
                <span className="grid size-6 flex-none place-items-center rounded-md border border-border font-mono text-xs">
                  {it.ic}
                </span>
                <span className="min-w-0">
                  <b className="block text-xs font-medium">{it.label}</b>
                  <span className="block truncate text-[11px] text-muted-foreground">{it.sub}</span>
                </span>
              </button>
            ))
          ) : (
            <div className="px-2.5 py-2 text-xs text-muted-foreground">No matching block</div>
          )}
        </div>
      )}

      {/* AI command menu */}
      {aiMenu && (
        <div
          className="fixed z-[120] w-72 rounded-lg border border-border bg-card py-1 shadow-lg"
          style={{ left: Math.max(12, aiMenu.x), top: aiMenu.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 pb-1.5 pt-1">
            <Sparkles className="size-3.5 flex-none text-primary" />
            <input
              autoFocus
              placeholder="Ask AI to edit this line…"
              value={aiMenu.prompt}
              onChange={(e) => setAiMenu((m) => m && { ...m, prompt: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && aiMenu.prompt.trim())
                  void runAi("custom", aiMenu.blockId, aiMenu.prompt.trim());
                if (e.key === "Escape") setAiMenu(null);
              }}
              className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none"
            />
            <button
              className="grid size-6 flex-none place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
              disabled={!aiMenu.prompt.trim()}
              onClick={() => void runAi("custom", aiMenu.blockId, aiMenu.prompt.trim())}
              aria-label="Run"
            >
              <ArrowRight className="size-3.5" />
            </button>
          </div>
          <div className="label px-2.5 py-1 text-[10px]">Suggested</div>
          {AI_COMMANDS.map((c) => (
            <button
              key={c.kind}
              className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-muted"
              onClick={() => void runAi(c.kind, aiMenu.blockId)}
            >
              <span className="grid size-6 flex-none place-items-center rounded-md border border-border font-mono text-xs text-primary">
                {c.ic}
              </span>
              <span className="min-w-0">
                <b className="block text-xs font-medium">{c.label}</b>
                <span className="block truncate text-[11px] text-muted-foreground">{c.sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {(slash || aiMenu) && (
        <div
          className="fixed inset-0 z-[110]"
          onMouseDown={() => {
            setSlash(null);
            setAiMenu(null);
          }}
        />
      )}

    </div>
  );
}
