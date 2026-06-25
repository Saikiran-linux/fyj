/**
 * Raw fetch helpers for the LLM nodes in our LangGraph graphs. We orchestrate
 * with LangGraph (StateGraph) but call the model APIs over plain `fetch` — the
 * same pattern as src/summarize.ts / src/embeddings.ts — so nothing heavier than
 * fetch has to run on the Workers runtime. Hybrid per f-141: OpenAI gpt-4o-mini
 * for cheap extraction, Anthropic Claude for match rationale (Haiku) and résumé
 * tailoring (Sonnet).
 */

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
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "content-type": "application/json",
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

/** Anthropic Messages call returning raw text. */
export async function anthropicText(
  env: Env,
  opts: { system: string; user: string; model: string; maxTokens: number; temperature?: number },
): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: opts.maxTokens,
          temperature: opts.temperature ?? 0,
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
        }),
      });
      if (!res.ok) {
        lastErr = `anthropic ${res.status}: ${await res.text()}`;
        await sleep(400 * attempt);
        continue;
      }
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = (data.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      if (!text.trim()) {
        lastErr = "anthropic empty content";
        await sleep(400 * attempt);
        continue;
      }
      return text;
    } catch (e) {
      lastErr = (e as Error).message;
      await sleep(400 * attempt);
    }
  }
  throw new Error(`anthropicText failed: ${lastErr}`);
}

/** Anthropic Messages call whose reply we parse as JSON. */
export async function anthropicJson<T>(
  env: Env,
  opts: { system: string; user: string; model: string; maxTokens: number },
): Promise<T> {
  const text = await anthropicText(env, { ...opts, temperature: 0 });
  return extractJson<T>(text);
}
