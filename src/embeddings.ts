/**
 * Embedding helper (f-134). One concern: turn text into the same 1536-d vector
 * space the fyj job index was embedded in, so search_jobs(query_vec) is an
 * apples-to-apples cosine search.
 *
 * The index uses OpenAI `text-embedding-3-small` (1536 dims) — this MUST stay in
 * lockstep with the model fyj_scanner embeds jobs with (src/embeddings.mjs), or
 * scores are meaningless. No SDK: a single fetch keeps the Worker bundle small.
 * Needs the OPENAI_API_KEY secret (`wrangler secret put OPENAI_API_KEY`).
 */

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

// text-embedding-3 accepts ~8191 tokens. ~4 chars/token, so cap well under that
// to avoid 400s. Resume embed-inputs (title + signals + summary) are short; this
// only bites pathological inputs.
const MAX_CHARS = 24_000;

/** Core call. Sends `input` VERBATIM (no whitespace munging) — fyj_scanner embeds
 *  jobs with newlines intact and the embedder keys off the labeled `Key: value`
 *  line structure, so we must not collapse them or we'd shift the distribution. */
async function embed(env: Env, input: string): Promise<number[]> {
  if (!input) throw new Error("embed: empty input");
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input, dimensions: EMBEDDING_DIMS }),
  });
  if (!res.ok) throw new Error(`openai embeddings ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  const embedding = json.data?.[0]?.embedding;
  if (!embedding || embedding.length !== EMBEDDING_DIMS) {
    throw new Error(`openai embeddings: unexpected vector (len ${embedding?.length})`);
  }
  return embedding;
}

/**
 * Embed a pre-built input VERBATIM (newlines preserved). Use this for the
 * resume embed-input, which is assembled to mirror jobs.buildJobText (title +
 * signal block + JD-style summary) so it lands in the job vector distribution.
 */
export async function embedRaw(
  env: Env,
  text: string,
): Promise<{ embedding: number[]; model: string }> {
  const input = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
  return { embedding: await embed(env, input), model: EMBEDDING_MODEL };
}

/**
 * Embed a free-text QUERY (e.g. the dashboard command bar). Queries are short,
 * single-line natural language — collapsing whitespace is harmless and keeps the
 * input tidy. For documents (resumes) use embedRaw via the summarize pipeline.
 */
export async function embedText(
  env: Env,
  text: string,
): Promise<{ embedding: number[]; model: string }> {
  const input = text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  return { embedding: await embed(env, input), model: EMBEDDING_MODEL };
}
