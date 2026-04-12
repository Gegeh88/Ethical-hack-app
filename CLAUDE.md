# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**haxvibe** — AI-assisted ethical hacking SaaS for Hungarian SMEs. Queue-driven vulnerability scanning with legal compliance (Btk. 423. §), domain ownership verification, consent audit trails, and AI-powered report generation.

## Commands

```bash
pnpm install                  # Install all workspace dependencies
docker compose up -d redis    # Start Redis (required for worker/queue)
pnpm dev                      # Run all apps in parallel (web :3000, api :4000, worker)
pnpm build                    # Build all apps and packages
pnpm typecheck                # tsc --noEmit across all packages
pnpm lint                     # ESLint across all packages

# Per-app dev (from repo root)
pnpm --filter @haxvibe/api dev
pnpm --filter @haxvibe/web dev
pnpm --filter @haxvibe/worker dev

# Per-app typecheck
pnpm --filter @haxvibe/api typecheck
```

No test framework is configured yet. Tests will use `pnpm test` when added.

## Architecture

pnpm monorepo with Turbo. Three apps + two shared packages:

- **`apps/api`** — Fastify 4 REST server (ESM, `tsx watch` in dev). Supabase service-role client for DB. Health endpoint at `/api/v1/health`.
- **`apps/web`** — Next.js 14 App Router. Tailwind + shadcn/ui. Supabase browser client (anon key) for auth. Hungarian-first UI.
- **`apps/worker`** — BullMQ job processor. Scanner agents (passive, Nuclei), Gemini LLM for report generation, Puppeteer for PDF.
- **`packages/shared-types`** — Zod schemas + TypeScript types shared across all apps. Source of truth for domain entities (`Domain`, `ScanJob`, `Finding`, `EnrichedFinding`, enums).
- **`packages/db-schema`** — SQL migration files (ordered `0001_` through `0011_`). Applied via Supabase MCP tools, not an ORM.

## Key Patterns

- **No ORM.** Raw SQL via `postgres` driver. Supabase RLS requires auth context at connection level; ORM complicates this. Possible Drizzle adoption later.
- **ESM everywhere.** API and worker are `"type": "module"`. Use `.js` extensions in imports (e.g., `import { config } from './config.js'`).
- **Zod for validation.** Both API request validation and shared type definitions. The same schema validates frontend forms and backend payloads.
- **Config via Zod.** Each app validates its env vars at startup (`src/config.ts`). If env is wrong, the app crashes immediately with a clear message.
- **Pino logging.** All server apps use Pino with `pino-pretty` in dev.
- **Legal-first scans.** Every scan must pass: domain verified + active consent + org ownership match + shared hosting acknowledgment. Append-only `audit_log` table.

## Database

Supabase PostgreSQL 17 (cloud, eu-west-1). Schema lives in `packages/db-schema/migrations/`.

Key tables: `organizations`, `app_users`, `domains`, `domain_verifications`, `consent_records`, `scan_jobs`, `scan_results`, `vulnerabilities`, `reports`, `audit_log`, `ai_usage`.

RLS enabled on all user-facing tables. Helper functions `auth_org_id()` and `is_admin()` used in policies. Audit log is append-only (UPDATE/DELETE blocked by rule).

## Environment

Copy `.env.example` to `.env.local`. Required groups: Supabase (URL + keys), database connection strings, Gemini API key, Redis URL. See `.env.example` for all variables.

LLM provider is **Gemini** (gemini-2.5-flash / gemini-2.5-pro), not Claude. The `@google/generative-ai` SDK is used in the worker.

## TypeScript

Base config in `tsconfig.base.json`: strict mode, ES2022 target, Bundler module resolution. API and worker override to NodeNext. `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess` are all enabled.

## Specialized Agents

The `.claude/agents/` directory contains role prompts for domain-specific subagents: `haxvibe-backend`, `haxvibe-frontend`, `haxvibe-worker`, `haxvibe-db`, `haxvibe-devops`. Use the matching agent type for focused work in each area.

## Blueprint

`docs/IMPLEMENTATION_PLAN.md` contains the full engineering blueprint (sections 1-20). Reference it for architectural decisions, security design, scan pipeline details, and phase planning.
