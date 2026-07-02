/**
 * Embedding helper. One concern: turn candidate/query text into the SAME vector
 * space the fyj job index is embedded in, so search_jobs(query_vec) is an
 * apples-to-apples cosine search.
 *
 * The index (fyj_scanner, f-152) embeds jobs with **Voyage `voyage-4-large`
 * truncated to 1024 dims** (Matryoshka `output_dimension`), `input_type='document'`.
 * This side is the QUERY side of Voyage's asymmetric-retrieval pairing, so we
 * embed résumés + search queries with `input_type='query'` at the same model +
 * 1024 dims. This MUST stay in lockstep with fyj_scanner/src/embeddings.mjs
 * (EMBEDDING_MODEL / EMBEDDING_DIM) — a model or dimension mismatch makes every
 * cosine score meaningless (and pgvector rejects a wrong-dim write outright).
 *
 * No SDK: a single fetch keeps the Worker bundle small. Needs the VOYAGE_API_KEY
 * secret (`wrangler secret put VOYAGE_API_KEY` — the same key the reranker uses).
 * Voyage is NOT a Cloudflare AI Gateway provider, so these calls go direct (the
 * OpenAI/Anthropic chat calls still route through the gateway).
 */

export const EMBEDDING_MODEL = "voyage-4-large";
export const EMBEDDING_DIMS = 1024;

// Voyage voyage-4-large context is ~120k tokens; cap input for predictable
// cost/latency. Résumé embed-inputs (title + signals + summary) and NL queries
// are short — this only bites pathological inputs.
const MAX_CHARS = 24_000;

/**
 * Core call. Embeds a single text with Voyage at 1024 dims. `inputType` is
 * 'query' for the candidate/query side (résumés, search queries) — the index
 * embeds jobs as 'document', and the asymmetric pairing is what makes the two
 * vectors optimized for cross-retrieval rather than merely same-model.
 */
async function embed(env: Env, input: string, inputType: "query" | "document"): Promise<number[]> {
  if (!input) throw new Error("embed: empty input");
  if (!env.VOYAGE_API_KEY) throw new Error("VOYAGE_API_KEY is not configured");

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: [input],
      input_type: inputType,
      output_dimension: EMBEDDING_DIMS,
    }),
  });
  if (!res.ok) throw new Error(`voyage embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  const embedding = json.data?.[0]?.embedding;
  if (!embedding || embedding.length !== EMBEDDING_DIMS) {
    throw new Error(`voyage embeddings: unexpected vector (len ${embedding?.length})`);
  }
  return embedding;
}

/**
 * Embed a pre-built résumé input VERBATIM (newlines preserved). Assembled to
 * mirror the index's job text (title + signal block + JD-style summary) so it
 * lands in the job vector distribution. Query side of the asymmetric pairing.
 */
export async function embedRaw(
  env: Env,
  text: string,
): Promise<{ embedding: number[]; model: string }> {
  const input = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
  return { embedding: await embed(env, input, "query"), model: EMBEDDING_MODEL };
}

/**
 * Embed a free-text QUERY (e.g. the dashboard command bar / Explore search).
 * Queries are short, single-line natural language — collapsing whitespace is
 * harmless and keeps the input tidy. For résumé documents use embedRaw.
 */
export async function embedText(
  env: Env,
  text: string,
): Promise<{ embedding: number[]; model: string }> {
  const input = text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  return { embedding: await embed(env, input, "query"), model: EMBEDDING_MODEL };
}
