/**
 * Embedding helper (f-134). One concern: turn resume / query text into the same
 * 1536-d vector space the fyj job index was embedded in, so search_jobs(query_vec)
 * is an apples-to-apples cosine search.
 *
 * The index uses OpenAI `text-embedding-3-small` (1536 dims) — this MUST stay in
 * lockstep with the model fyj_scanner embeds jobs with, or scores are meaningless.
 * No SDK: a single fetch keeps the Worker bundle small and avoids Node shims.
 * Needs the OPENAI_API_KEY secret (`wrangler secret put OPENAI_API_KEY`).
 */

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

// text-embedding-3 accepts ~8191 tokens. ~4 chars/token, so cap well under that
// to leave headroom and avoid 400s on pathologically long resumes. The most
// signal lives up top anyway (summary, recent roles).
const MAX_CHARS = 24_000;

export async function embedText(
  env: Env,
  text: string,
): Promise<{ embedding: number[]; model: string }> {
  const input = text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  if (!input) throw new Error("embedText: empty input");
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
  return { embedding, model: EMBEDDING_MODEL };
}
