/**
 * Embedding helper (f-134, moved to Voyage in f-152). One concern: turn text
 * into the same 1024-d vector space the fyj job index was embedded in, so
 * search_jobs(query_vec) is an apples-to-apples cosine search.
 *
 * The index uses Voyage `voyage-4-large` truncated to 1024 dims via
 * output_dimension (src/embeddings.mjs in fyj_scanner) — this MUST stay in
 * lockstep with the model fyj_scanner embeds jobs with, or scores are
 * meaningless. Needs the VOYAGE_API_KEY secret (already set for reranking,
 * `wrangler secret put VOYAGE_API_KEY`) — same key, no new secret needed.
 *
 * input_type differs by caller: jobs are always the "document" side, so the
 * résumé/command-bar side embeds as "query" (embedText) or "document"
 * (embedRaw, mirroring jobs.buildJobText's shape) — Voyage's asymmetric
 * retrieval mode, which pairs the two roles for better cross-retrieval than
 * embedding both sides identically.
 */

export const EMBEDDING_MODEL = "voyage-4-large";
export const EMBEDDING_DIMS = 1024;

// voyage-4-large accepts up to 120K tokens; resume embed-inputs (title +
// signals + summary) are short, so this cap only bites pathological inputs.
const MAX_CHARS = 24_000;

/** Core call. Sends `input` VERBATIM (no whitespace munging) — fyj_scanner embeds
 *  jobs with newlines intact and the embedder keys off the labeled `Key: value`
 *  line structure, so we must not collapse them or we'd shift the distribution. */
async function embed(
  env: Env,
  input: string,
  inputType: "document" | "query",
): Promise<number[]> {
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
      input,
      input_type: inputType,
      output_dimension: EMBEDDING_DIMS,
    }),
  });
  if (!res.ok) throw new Error(`voyage embeddings ${res.status}: ${await res.text()}`);

  // Voyage's response is OpenAI-shaped: { data: [{ embedding, index }], usage }.
  const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  const embedding = json.data?.[0]?.embedding;
  if (!embedding || embedding.length !== EMBEDDING_DIMS) {
    throw new Error(`voyage embeddings: unexpected vector (len ${embedding?.length})`);
  }
  return embedding;
}

/**
 * Embed a pre-built input VERBATIM (newlines preserved). Use this for the
 * resume embed-input, which is assembled to mirror jobs.buildJobText (title +
 * signal block + JD-style summary) so it lands in the job vector distribution.
 * input_type='document' — the résumé precis reads like a job posting (see
 * src/summarize.ts), so it plays the same role as the job side it's compared
 * against.
 */
export async function embedRaw(
  env: Env,
  text: string,
): Promise<{ embedding: number[]; model: string }> {
  const input = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
  return { embedding: await embed(env, input, "document"), model: EMBEDDING_MODEL };
}

/**
 * Embed a free-text QUERY (e.g. the dashboard command bar). Queries are short,
 * single-line natural language — collapsing whitespace is harmless and keeps the
 * input tidy. input_type='query' primes Voyage's asymmetric retrieval mode for
 * this being the search side, not the document side.
 */
export async function embedText(
  env: Env,
  text: string,
): Promise<{ embedding: number[]; model: string }> {
  const input = text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  return { embedding: await embed(env, input, "query"), model: EMBEDDING_MODEL };
}
