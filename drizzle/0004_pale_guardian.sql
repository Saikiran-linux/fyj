-- f-152: OpenAI text-embedding-3-small (1536d) -> Voyage voyage-4-large
-- (1024d), matching the job index's model swap in lockstep. Existing 1536d
-- vectors aren't valid at the new dimension and can't cast automatically —
-- null them out (hard cutover; matcher.ts already treats a null embedding as
-- "nothing to match yet" rather than erroring). Re-uploading the résumé (or
-- any future on-demand re-embed path) repopulates it under the new model.
UPDATE "client_profiles" SET "embedding" = NULL, "embedding_model" = NULL, "embedded_at" = NULL WHERE "embedding" IS NOT NULL;
ALTER TABLE "client_profiles" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);