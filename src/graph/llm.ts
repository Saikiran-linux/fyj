/**
 * Raw fetch helpers for the LLM nodes in our LangGraph graphs. We orchestrate
 * with LangGraph (StateGraph) but call the model APIs over plain `fetch` — the
 * same pattern as src/summarize.ts / src/embeddings.ts — so nothing heavier than
 * fetch has to run on the Workers runtime. Hybrid per f-141: OpenAI gpt-4o-mini
 * for cheap extraction, Anthropic Claude for match rationale (Haiku) and résumé
 * tailoring (Sonnet).
 */

import { openaiChatUrl, anthropicMessagesUrl, aiGatewayHeaders } from "../observability";

export const HAIKU = "claude-haiku-4-5-20251001";
export const SONNET = "claude-sonnet-4-6";

const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function hasAnthropic(env: Env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/** Pull the first JSON object/array out of a model reply (tolerates code fences). */
export function extractJson<T>(text: string): T {
  const fenced = text.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.search(/[[{]/);
  if (start === -1) throw new Error("no JSON in model output");
  // find the matching close by scanning (handles nested braces)
  const open = fenced[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < fenced.length; i++) {
    if (fenced[i] === open) depth++;
    else if (fenced[i] === close) {
      depth--;
      if (depth === 0) return JSON.parse(fenced.slice(start, i + 1)) as T;
    }
  }
  throw new Error("unterminated JSON in model output");
}

/** OpenAI chat completion that returns a JSON object (response_format json_object). */
export async function openaiJson<T>(
  env: Env,
  opts: { system: string; user: string; model?: string; maxTokens?: number },
): Promise<T> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Routes via Cloudflare AI Gateway when AI_GATEWAY_URL is set (logs/cost/cache).
      const res = await fetch(openaiChatUrl(env), {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "content-type": "application/json",
          ...aiGatewayHeaders(env),
        },
        body: JSON.stringify({
          model: opts.model ?? "gpt-4o-mini",
          temperature: 0,
          max_tokens: opts.maxTokens ?? 700,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
        }),
      });
      if (!res.ok) {
        lastErr = `openai ${res.status}: ${await res.text()}`;
        await sleep(300 * attempt);
        continue;
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        lastErr = "openai empty content";
        await sleep(300 * attempt);
        continue;
      }
      return extractJson<T>(content);
    } catch (e) {
      lastErr = (e as Error).message;
      await sleep(300 * attempt);
    }
  }
  throw new Error(`openaiJson failed: ${lastErr}`);
}

/**
 * A prompt segment. Use a plain string for un-cached content, or an object with
 * `cache: true` to drop a `cache_control: {type:"ephemeral"}` breakpoint after
 * that block — everything up to and including it becomes a reusable prefix.
 * Caching is a prefix match, so the cached blocks must be byte-identical AND
 * come first; volatile content goes in later (un-cached) segments. Prompt
 * caching is GA (no beta header); cache reads bill ~0.1x, writes ~1.25x, 5-min
 * TTL. Note the per-model minimum cacheable prefix (Haiku 4.5 = 4096 tokens,
 * Sonnet 4.6 = 2048) — below it the block silently won't cache.
 */
export type Seg = string | { text: string; cache?: boolean };

type TextBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };

function toContent(input: Seg | Seg[]): string | TextBlock[] {
  if (typeof input === "string") return input;
  const segs = Array.isArray(input) ? input : [input];
  return segs.map((s) => {
    const seg = typeof s === "string" ? { text: s, cache: false } : s;
    const block: TextBlock = { type: "text", text: seg.text };
    if (seg.cache) block.cache_control = { type: "ephemeral" };
    return block;
  });
}

/**
 * Normalised token accounting returned by every model call, so callers (e.g. the
 * prompt lab) can compare cost across providers on one shape. cache* are 0 for
 * providers without prompt caching.
 */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function emptyUsage(): LlmUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/**
 * Anthropic Messages call returning raw text + usage. `system`/`user` accept
 * cacheable segments. `anthropicText` below drops the usage for existing callers.
 */
export async function callAnthropic(
  env: Env,
  opts: { system: Seg | Seg[]; user: Seg | Seg[]; model: string; maxTokens: number; temperature?: number },
): Promise<{ text: string; usage: LlmUsage }> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  let lastErr = "";
  // Newer models (Sonnet 5, Opus 4.8, …) reject `temperature`; drop it and retry
  // on that specific 400 instead of failing. Older models keep it.
  let includeTemperature = true;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const body: Record<string, unknown> = {
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: toContent(opts.system),
        messages: [{ role: "user", content: toContent(opts.user) }],
      };
      if (includeTemperature) body.temperature = opts.temperature ?? 0;
      // Routes via Cloudflare AI Gateway when AI_GATEWAY_URL is set (logs/cost/cache).
      const res = await fetch(anthropicMessagesUrl(env), {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          ...aiGatewayHeaders(env),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 400 && includeTemperature && /temperature/i.test(errText)) {
          includeTemperature = false; // retry immediately without temperature
          continue;
        }
        lastErr = `anthropic ${res.status}: ${errText}`;
        await sleep(400 * attempt);
        continue;
      }
      const data = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      };
      const u = data.usage;
      const usage: LlmUsage = {
        inputTokens: u?.input_tokens ?? 0,
        outputTokens: u?.output_tokens ?? 0,
        cacheReadTokens: u?.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
      };
      // Surface cache activity so a `wrangler tail` can confirm caching works.
      if (usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0) {
        console.log(
          JSON.stringify({
            at: "anthropic.cache",
            model: opts.model,
            read: usage.cacheReadTokens,
            write: usage.cacheWriteTokens,
          }),
        );
      }
      const text = (data.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      if (!text.trim()) {
        lastErr = "anthropic empty content";
        await sleep(400 * attempt);
        continue;
      }
      return { text, usage };
    } catch (e) {
      lastErr = (e as Error).message;
      await sleep(400 * attempt);
    }
  }
  throw new Error(`anthropicText failed: ${lastErr}`);
}

/** Anthropic Messages call returning raw text. `system`/`user` accept cacheable segments. */
export async function anthropicText(
  env: Env,
  opts: { system: Seg | Seg[]; user: Seg | Seg[]; model: string; maxTokens: number; temperature?: number },
): Promise<string> {
  return (await callAnthropic(env, opts)).text;
}

/** Anthropic Messages call whose reply we parse as JSON. */
export async function anthropicJson<T>(
  env: Env,
  opts: { system: Seg | Seg[]; user: Seg | Seg[]; model: string; maxTokens: number },
): Promise<T> {
  const text = await anthropicText(env, { ...opts, temperature: 0 });
  return extractJson<T>(text);
}

/** OpenAI chat completion returning raw text + usage (sibling of openaiJson). */
export async function openaiText(
  env: Env,
  opts: { system: string; user: string; model: string; maxTokens: number; temperature?: number; json?: boolean },
): Promise<{ text: string; usage: LlmUsage }> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  let lastErr = "";
  // GPT-5 / o-series reasoning models reject `temperature` (only the default) and
  // require `max_completion_tokens` instead of `max_tokens`. Adapt on the specific
  // 400s rather than hardcoding which model needs what.
  let includeTemperature = true;
  let useMaxCompletion = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const body: Record<string, unknown> = {
        model: opts.model,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      };
      body[useMaxCompletion ? "max_completion_tokens" : "max_tokens"] = opts.maxTokens;
      if (includeTemperature) body.temperature = opts.temperature ?? 0;
      const res = await fetch(openaiChatUrl(env), {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "content-type": "application/json",
          ...aiGatewayHeaders(env),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 400 && !useMaxCompletion && /max_completion_tokens|'max_tokens'/i.test(errText)) {
          useMaxCompletion = true; // retry with the reasoning-model token param
          continue;
        }
        if (res.status === 400 && includeTemperature && /temperature/i.test(errText)) {
          includeTemperature = false; // retry without temperature
          continue;
        }
        lastErr = `openai ${res.status}: ${errText}`;
        await sleep(300 * attempt);
        continue;
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        lastErr = "openai empty content";
        await sleep(300 * attempt);
        continue;
      }
      const u = data.usage;
      const usage: LlmUsage = {
        inputTokens: u?.prompt_tokens ?? 0,
        outputTokens: u?.completion_tokens ?? 0,
        cacheReadTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: 0,
      };
      return { text: content, usage };
    } catch (e) {
      lastErr = (e as Error).message;
      await sleep(300 * attempt);
    }
  }
  throw new Error(`openaiText failed: ${lastErr}`);
}

/** OpenAI model ids (gpt-*, o1/o3/o4-*, chatgpt-*) route to the OpenAI API; everything else to Anthropic. */
export function isOpenAiModel(model: string): boolean {
  return /^(gpt-|o[1-9]|chatgpt-|text-)/i.test(model);
}

/**
 * Provider-dispatching text completion used by the prompt lab: pick OpenAI vs
 * Anthropic from the model id so any stage can run on either provider. Plain
 * strings only (no prompt-cache segments) — the lab runs one-off, not hot loops.
 */
export async function runChat(
  env: Env,
  opts: { system: string; user: string; model: string; maxTokens: number; temperature?: number; json?: boolean },
): Promise<{ text: string; usage: LlmUsage }> {
  if (isOpenAiModel(opts.model)) return openaiText(env, opts);
  return callAnthropic(env, {
    system: opts.system,
    user: opts.user,
    model: opts.model,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
  });
}
