# haxvibe

AI-alapú webes sérülékenységvizsgáló SaaS magyar KKV-knak.

Status: **Day 1 skeleton** (2 weeks MVP in progress)

## Stack

- **Frontend:** Next.js 14 (App Router) + Tailwind + shadcn/ui — deployed on Netlify
- **API:** Fastify 4 + Zod + Supabase service client
- **Worker:** BullMQ + Nuclei scanner + Gemini LLM
- **DB / Auth / Storage:** Supabase (Postgres 17 + RLS, eu-west-1)
- **Queue / Cache:** Redis (Docker Compose locally, Upstash/managed in prod)

## Structure

```
apps/
  web/         Next.js frontend
  api/         Fastify REST + SSE server
  worker/      BullMQ worker with scanner agents
packages/
  shared-types/  Zod schemas + TypeScript types shared across apps
  db-schema/     SQL migrations (source of truth for Supabase schema)
docs/
  IMPLEMENTATION_PLAN.md   Full engineering blueprint
```

## Development

```bash
# Prerequisites: Node 20+, pnpm 10+, Docker Desktop, WSL2 (on Windows)

cp .env.example .env.local   # then fill in the secrets
pnpm install
docker compose up -d redis
pnpm dev
```

## Legal

All scans require explicit domain ownership verification and consent
logging, in compliance with Btk. 423. § (Hungarian Criminal Code on
unauthorized system access). See `docs/IMPLEMENTATION_PLAN.md` §2.
