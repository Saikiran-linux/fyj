# Ops Console — Web UI (f-133)

Next.js (App Router) front end for the ops-console. Clay-inspired design per
[`../docs/UI.md`](../docs/UI.md). UI only — all data comes from the Worker API
(`src/api.ts` in the repo root) over `NEXT_PUBLIC_API_URL`; auth via
`better-auth/react`.

## Run
```bash
cp .env.local.example .env.local   # set NEXT_PUBLIC_API_URL to the Worker origin
npm install
npm run dev                        # http://localhost:3000  (API on :8787)
npm run typecheck
```

## Structure
- `app/(app)/*` — authed shell (session-gated `layout.tsx` → `Rail` + screen).
  Dashboard, Clients, Client detail, Campaign matches, Members, + placeholders.
- `app/sign-in` — email/password sign-in & sign-up (org auto-created on signup).
- `components/ui/*` — primitives (`Button`, `Card`, `Table`, `Tabs`, `Chip`,
  `Avatar`) built from the `docs/UI.md` tokens in `app/globals.css` (Tailwind v4).
- `lib/api.ts` — typed client for the Worker API · `lib/auth-client.ts` — Better Auth.

## Deploy (Cloudflare Pages)
Add `@opennextjs/cloudflare` and its build/adapter step (see
[`../docs/INFRA-SETUP.md`](../docs/INFRA-SETUP.md)). Kept out of the shell so it
builds as a standard Next app today.

## Status
Shell + core screens, **typechecked**. Not yet run end-to-end — needs the Worker
API live (Neon + Hyperdrive + secrets, see `../docs/INFRA-SETUP.md`). The Jobs
search, resume upload/embed, live matcher, tracker, and client portal are the
next features (f-134/135/136/137).
