# Ethical Hack App — Implementációs Blueprint

**Dokumentum verzió:** 1.0
**Utolsó frissítés:** 2026-04-11
**Státusz:** Draft → fejlesztésre kész
**Cél olvasó:** Claude Code agent / solo fullstack developer

> Ez a dokumentum a teljes mérnöki blueprint. Minden döntés indokolt, minden trade-off nevesítve. Egy Claude Code agentnek ebből anélkül kell tudnia dolgoznia, hogy az architektúrán visszakérdezne.

## Tartalomjegyzék

0. [Dokumentum meta](#0-dokumentum-meta)
1. [Áttekintés és célok](#1-áttekintés-és-célok)
2. [Jogi keretrendszer (CRITICAL)](#2-jogi-keretrendszer-critical)
3. [Magas szintű architektúra](#3-magas-szintű-architektúra)
4. [Tech stack döntések](#4-tech-stack-döntések)
5. [Adatbázis séma](#5-adatbázis-séma)
6. [Multi-Agent architektúra](#6-multi-agent-architektúra)
7. [API endpointok](#7-api-endpointok)
8. [Mappastruktúra](#8-mappastruktúra)
9. [Docker Compose (dev)](#9-docker-compose-dev)
10. [Environment változók](#10-environment-változók)
11. [BullMQ konfiguráció](#11-bullmq-konfiguráció)
12. [SSE progress stream](#12-sse-progress-stream)
13. [Claude API prompt registry](#13-claude-api-prompt-registry)
14. [Hibakezelési stratégia](#14-hibakezelési-stratégia)
15. [Biztonsági követelmények](#15-biztonsági-követelmények)
16. [Fizetési modell](#16-fizetési-modell)
17. [UI/UX képernyők](#17-uiux-képernyők)
18. [Admin felület](#18-admin-felület)
19. [Fázisolási terv](#19-fázisolási-terv)
20. [Függelékek](#20-függelékek)

---

## 0. Dokumentum meta

- **Projekt kódnév:** `eha` (Ethical Hack App)
- **Monorepo neve:** `ethical-hack-app`
- **Elsődleges nyelv:** TypeScript (strict mode mindenhol)
- **Package manager:** pnpm 9+ (workspace + turborepo)
- **Node verzió:** 20 LTS
- **Cél MVP időkeret:** 4-6 hét solo developer + AI-assisted
- **Cél piac:** Magyar KKV-k (elsődleges), angol UI másodlagos

**Fejlesztői setup feltételezése:** Windows 11 + WSL2 (Ubuntu 24.04), Docker Desktop WSL2 backenddel, VS Code + Claude Code CLI.

---

## 1. Áttekintés és célok

### 1.1 A szolgáltatás egymondatban

Automatizált, AI-asszisztált etikus sérülékenységvizsgálat magyar KKV-knak, ahol a jogszerű megbízás, a scan végrehajtása, a magyar nyelvű jelentés és az opcionális javítás egy integrált workflow-ban történik.

### 1.2 User journey (happy path)

1. Ügyfél regisztrál → létrejön az organization
2. Hozzáad egy domain-t → unverified állapotban
3. Verification wizard-dal (DNS/meta/file) igazolja a tulajdont
4. Scan indításakor ToS + Btk. 423. § beleegyezést rögzít
5. Scan fut (passive + opcionálisan active) progress SSE-vel
6. Jelentés generálódik (Claude-dal magyar magyarázat + PDF)
7. Ügyfél letölti a PDF-t, opcionálisan remediation-t rendel
8. Admin (szolgáltató) Claude-dal fix javaslatot generál, implementálja
9. Ügyfél értesítést kap a javítás elkészültéről

### 1.3 Nem-funkcionális követelmények

| Követelmény | Érték | Indoklás |
|---|---|---|
| Scan átfutás (passive) | ≤ 2 perc | User-perception türelmi határ |
| Scan átfutás (full) | ≤ 30 perc hard cap | Nuclei futási idő + AI reporting |
| API p95 latency | ≤ 300 ms (nem scan endpointok) | UX |
| Uptime cél | 99.5% (MVP) | Realisztikus solo ops |
| Adattárolási retenció | Scan log 90 nap, vuln 12 hónap | GDPR + storage cost |
| Párhuzamos scanek | 3 worker concurrency induláskor | Nuclei memory footprint |
| Max 1 aktív scan / domain | Hard guard | Protect target from self-DoS |
| AI költség / scan | ≤ 0.15 USD átlag | Margin protection |

---

## 2. Jogi keretrendszer (CRITICAL)

**Ezt a réteget először kell lerakni. Minden kód ami ezt megkerüli, security és jogi incidens.**

### 2.1 Vonatkozó szabályozás

- **Btk. 423. §** (Információs rendszer vagy adat megsértése): jogosulatlan hozzáférés, vizsgálat, manipuláció bűncselekmény. Felmentő: a jogosult tulajdonos explicit beleegyezése.
- **GDPR** (EU 2016/679): adatalany jogai (export, törlés, hozzáférés).
- **2018. évi LIII. tv.** (info. önrend.): magyar GDPR végrehajtás.
- **NIS2** (hatálybalépés 2024+): nem érint közvetlenül MVP szinten, de audit logging fontos.

### 2.2 Compliance primitívek (kódban kötelező)

A következő 4 dolognak minden scan előtt teljesülnie kell, ellenkező esetben a scan nem indulhat:

1. **Domain verified** — `domains.verified_at IS NOT NULL` és `verification_expires_at > now()`
2. **Active consent** — a legfrissebb `consent_records` rekord `active=true`, tartalmazza a ToS verziót, user IP-t, user agentet
3. **Ownership match** — a kezdeményező `app_users.organization_id` egyezik a domain `organization_id`-jával
4. **Shared hosting ack** (ha alkalmazandó) — ha `domains.is_shared_hosting=true`, akkor `consent_records.shared_hosting_acknowledged=true`

Ezt **egyetlen** szervercall, a `canScanDomain()` függvény ellenőrzi, és a BullMQ job enqueue-ja előtt **és** a worker processor elején **is** lefut (defense in depth).

### 2.3 Audit trail követelmények

Minden alábbi eseményt `audit_log` táblába kell írni:
- `auth.login`, `auth.logout`, `auth.2fa_enabled`
- `domain.added`, `domain.verified`, `domain.verification_attempt`
- `consent.granted`, `consent.revoked`
- `scan.requested`, `scan.authorized`, `scan.started`, `scan.completed`, `scan.failed`, `scan.cancelled`
- `report.generated`, `report.downloaded`
- `remediation.requested`, `remediation.completed`
- `admin.override.*` (minden admin felülírás)
- `gdpr.export_requested`, `gdpr.delete_requested`

Az `audit_log` **append-only** (`RULE` blokkolja az UPDATE/DELETE-et) — lásd DB séma.

### 2.4 ToS kötelező elemek

A ToS-nak tartalmaznia **kell** (jogi review szükséges a launch előtt):
- Explicit kijelentés hogy az ügyfél felel a vizsgálat engedélyezéséért
- Hivatkozás Btk. 423. §-ra
- Shared hosting esetén az érintett másik fél értesítési kötelezettség
- Az adatkezelő azonosítása (szolgáltató neve, székhelye)
- Adatmegőrzési időtartamok
- Jogorvoslati lehetőségek

**Minden ToS verziózva** (pl. `"2026-04-01"`). A consent record rögzíti melyik verziót fogadta el az ügyfél.

### 2.5 Shared hosting figyelmeztetés

A domain hozzáadásakor a UI megkérdezi: "A domain megosztott hosting környezetben fut?". Ha igen:
- A scan indítás felületén plusz warning banner: "A megosztott hosting környezetben más ügyfelek szerverei is érintettek lehetnek. A vizsgálat csak az Ön domain-jére korlátozódik, de a rate limiting szigorúbb."
- Nuclei rate limit `50` req/sec-re (alapértelmezett `100` helyett)
- Passive-only fallback opció ajánlva

---

## 3. Magas szintű architektúra

### 3.1 Komponens diagram (ASCII)

```
┌──────────────────────────────────────────────────────────────┐
│                   FRONTEND — Next.js 14 (App Router)         │
│  [Landing] [Auth] [Dashboard] [Scan UI] [Admin Panel]        │
└─────────────────────────┬────────────────────────────────────┘
                          │ REST + SSE (Authorization: Bearer)
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                 API GATEWAY — Fastify                        │
│  JWT auth │ Rate limit │ Audit log │ Zod validation          │
│  Routes: auth/domains/scans/vulns/reports/billing/admin      │
└──┬──────────┬────────────┬────────────┬──────────────────────┘
   │          │            │            │
   ▼          ▼            ▼            ▼
┌────────┐ ┌──────────┐ ┌────────────┐ ┌────────────┐
│Supabase│ │  Redis   │ │  BullMQ    │ │  Stripe    │
│Postgres│ │  cache   │ │  queues    │ │  billing   │
│+ Auth  │ │pub/sub   │ │            │ │            │
│+Storage│ └──────────┘ └─────┬──────┘ └────────────┘
└────────┘                    │
                              ▼
               ┌──────────────────────────────┐
               │   WORKER POOL (Node.js)      │
               │  ┌──────────────────────┐    │
               │  │ DomainVerifyAgent    │    │
               │  │ PassiveScannerAgent  │    │
               │  │ NucleiScannerAgent   │───┼──► Docker spawn
               │  │ ReportGeneratorAgent │    │    (nuclei:v3, isolated net)
               │  │ FixAssistantAgent    │    │
               │  └──────────┬───────────┘    │
               └─────────────┼────────────────┘
                             │
                             ▼
                   ┌──────────────────┐
                   │  Anthropic API   │
                   │  (Claude models) │
                   └──────────────────┘
```

### 3.2 Miért szétválasztott API / Worker / Web

**Trade-off:** Mindent Next.js API routes-ban tartani egyszerűbb deploy, de:
- Scanner workerek long-running folyamatok → serverless nem fér bele a timeout-ba
- BullMQ worker lifecycle külön processzust igényel
- Docker-socket access csak dedikált worker konténernek adható oda
- A frontend és a backend külön skálázható

**Ajánlás:** 3 külön app (`web`, `api`, `worker`), monorepoban.

### 3.3 Adatfolyam egy scan során

```
1. User kattint "Scan indítása"
   └─► POST /api/v1/scans (API)
       ├─► canScanDomain() check (consent + verification)
       ├─► consent_records.insert()
       ├─► scan_jobs.insert(status='queued')
       ├─► audit_log('scan.requested')
       └─► scanQueue.add('scan:orchestrate', {scanJobId})
            │
            ▼
2. Worker veszi fel a job-ot
   └─► ScanProcessor.process()
       ├─► canScanDomain() újraellenőrzés (defense in depth)
       ├─► scan_jobs.update(status='running', started_at=now)
       ├─► audit_log('scan.authorized' + 'scan.started')
       ├─► emitProgress('started', ...)
       │
       ├─► [Step 1: Passive] PassiveScannerAgent.run()
       │   ├─► emitProgress('step', {name:'passive', pct:0})
       │   ├─► Promise.allSettled([ssl, headers, dns, whois, ports, cms])
       │   ├─► findings → vulnerabilities.insertMany()
       │   └─► emitProgress('step', {name:'passive', pct:100})
       │
       ├─► [Step 2: Active] (ha type='active' vagy 'full')
       │   └─► NucleiScannerAgent.run()
       │       ├─► docker run --rm --read-only nuclei:v3 ...
       │       ├─► parse JSONL progressively
       │       ├─► emitProgress('step', {name:'nuclei', pct:X}) periodically
       │       ├─► findings → vulnerabilities.insertMany()
       │       └─► cleanup tmp file
       │
       ├─► [Step 3: Report] reportQueue.add('report:generate', {scanJobId})
       │
       ├─► scan_jobs.update(status='completed', completed_at=now)
       ├─► audit_log('scan.completed')
       └─► emitProgress('done', {status:'completed'})

3. Report worker
   └─► ReportGeneratorAgent.generate()
       ├─► exec summary (Claude Sonnet)
       ├─► per-finding enrichment (Claude Sonnet, batch of 10)
       ├─► HTML render (eta template)
       ├─► Puppeteer → PDF
       ├─► Supabase Storage upload
       ├─► reports.insert()
       └─► emitProgress('report_ready', {pdfUrl})
```

### 3.4 Realtime kommunikáció

- **Worker → Redis pub/sub:** `PUBLISH scan:{scanJobId} {type,payload}`
- **API SSE endpoint:** feliratkozik a megfelelő Redis csatornára, átküldi a kliensnek
- **Kliens:** `EventSource('/api/v1/scans/:id/stream')`, hookolva a `useScanStream` hookon át a UI-ba

**Miért SSE és nem WebSocket?** Egyirányú kommunikáció (server → client), HTTP/2 natív, nem igényel külön protokoll-handshaket, Fastify-ban egyszerűbb, proxy-friendly (Railway, Cloudflare átengedi).

---

## 4. Tech stack döntések

| Réteg | Választás | Alternatíva | Miért ez |
|---|---|---|---|
| Frontend framework | Next.js 14 (App Router) | Remix, SvelteKit | Supabase SSR integráció, React ecosystem |
| Styling | Tailwind CSS + shadcn/ui | Chakra, MUI | Production-ready, hackelhető, nincs runtime cost |
| Form handling | react-hook-form + zod | Formik | Typed, zod share-elhető a backenddel |
| Backend framework | **Fastify 4** | Express, Hono | 2× throughput, schema-first, jobb TS |
| Validáció | zod (shared package) | joi, yup | Infer-elhető típusok, izomorf |
| DB | Supabase Postgres 16 | Neon, PlanetScale | Beépített auth + storage + RLS + realtime |
| ORM/query | `postgres` (porsager) + raw SQL | Prisma, Drizzle | Kontroll RLS-en, kevesebb magic. Drizzle acceptable, de RLS-sel nehezebb |
| Auth | Supabase Auth | Clerk, Auth.js | Egy vendor, olcsó, 2FA támogatott |
| Queue | BullMQ 5 | Temporal, SQS | TS-first, Redis-alapú, Bull Board UI |
| Cache / pubsub | Redis 7 (Upstash vagy Railway) | Valkey, DragonflyDB | BullMQ requirement |
| Scanner core | Nuclei v3 (Docker) | ZAP, Nikto, Wapiti | Aktív community, YAML templates, CVE coverage |
| AI | Anthropic Claude | OpenAI, Gemini | Jobb magyar, hosszú kontextus, struktúrált output |
| AI SDK | `@anthropic-ai/sdk` | raw fetch | Retry + type-safe |
| HTML → PDF | Puppeteer | wkhtmltopdf, weasyprint | Stílushű, maintained |
| Email | Resend | SendGrid, Mailgun | DX, olcsó, SPF/DKIM ready |
| Payments | Stripe (HUF support) | Barion | Global-ready, webhook reliability |
| Deploy | Railway | Render, Fly.io | Docker first, private networking, olcsó |
| Logs | Pino + Axiom | Datadog, Betterstack | Structured, olcsó |
| Errors | Sentry | Rollbar | Free tier, TS support |
| CI | GitHub Actions | - | Default |

### 4.1 Kulcs trade-off: `postgres` lib vs Drizzle ORM

**Döntés: `postgres` + raw SQL + kézzel írt repository réteg.**

Indok:
- Supabase RLS-sel bonyolultabb ORM-et használni (auth context a connection-höz kötött)
- Kevesebb függőség, kevesebb magic
- SQL migrations már külön `packages/db-schema`-ban vannak, nincs szükség ORM migráció-gen-re

**Ha később bonyolult lesz:** Drizzle bevezethető inkrementálisan, route-onként.

### 4.2 Kulcs trade-off: Nuclei Docker spawn vs hosted

**Döntés: Docker spawn a worker hostról (`docker.sock` mount).**

Indok:
- Izolált filesystem, read-only, memory + CPU cap
- Host network elszeparálva külön `nuclei-outbound` bridge-en
- Templates auto-update a container pull során

**Kockázat:** docker.sock = root ekvivalens. Mitigáció:
- Worker konténer nem exposáltan a web felé
- Production: sysbox vagy gVisor runtime dedikált scanner node-on
- MVP: egyetlen host, szigorú firewall, monitoring

### 4.3 Kulcs trade-off: Claude Sonnet vs Opus költség

**Döntés:**
- **Sonnet (`claude-sonnet-4-6`):** exec summary + finding enrichment (batch 10). Olcsó, gyors, elég a magyarra.
- **Opus (`claude-opus-4-6`):** fix suggestion (admin-oldali, kisebb volumen, kritikus quality).

**Becsült cost / scan:**
- 1 exec summary call: ~1500 out tokens → ~$0.023
- ~5 batch enrichment (50 findings): ~4000 out × 5 = 20k tokens → ~$0.30 Sonnet áron. **TÚL DRÁGA.**
- **Optimalizáció:** csak high+critical findings mennek AI enrichmentre (átlag 5-10), medium és alatt predefined templates magyar szöveggel. Így batch count 1-2, cost ~$0.06.

---

## 5. Adatbázis séma

### 5.1 Teljes DDL

A migrációk a `packages/db-schema/migrations/` alatt, sorban alkalmazva.

```sql
-- migrations/0001_extensions.sql
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";

-- migrations/0002_types.sql
create type scan_status as enum ('queued','running','completed','failed','cancelled');
create type severity_level as enum ('info','low','medium','high','critical');
create type verification_method as enum ('dns','meta','file');
create type scan_type as enum ('passive','active','full');
create type subscription_tier as enum ('free','pro','business');
create type remediation_status as enum ('requested','assigned','in_progress','review','completed','rejected');
create type actor_type as enum ('user','system','admin','api','worker');
```

```sql
-- migrations/0003_organizations.sql
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 2 and 200),
  billing_email text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  display_name text,
  role text default 'member' check (role in ('owner','admin','member')),
  locale text default 'hu',
  totp_enabled boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_app_users_org on app_users(organization_id);
```

```sql
-- migrations/0004_subscriptions.sql
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tier subscription_tier not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index uniq_sub_org on subscriptions(organization_id);
create index idx_sub_stripe on subscriptions(stripe_subscription_id);
```

```sql
-- migrations/0005_domains.sql
create table domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  added_by uuid references app_users(id),
  host text not null, -- lowercased, eTLD+1
  verified_at timestamptz,
  verification_method verification_method,
  verification_expires_at timestamptz,
  is_shared_hosting boolean default false,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint uniq_org_host unique (organization_id, host),
  constraint host_format check (host ~ '^[a-z0-9][-a-z0-9.]*\.[a-z]{2,}$')
);
create index idx_domains_org on domains(organization_id);
create index idx_domains_verified on domains(verified_at) where verified_at is not null;

create table domain_verifications (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references domains(id) on delete cascade,
  token text not null,
  method verification_method,
  status text not null default 'pending' check (status in ('pending','verified','failed','expired')),
  evidence jsonb,
  attempt_count integer default 0,
  created_at timestamptz default now(),
  verified_at timestamptz,
  expires_at timestamptz not null
);
create index idx_dv_domain_status on domain_verifications(domain_id, status);
create index idx_dv_token on domain_verifications(token);
```

```sql
-- migrations/0006_consent.sql
create table consent_records (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references domains(id) on delete cascade,
  user_id uuid not null references app_users(id),
  tos_version text not null,
  scan_scope text not null check (scan_scope in ('passive_only','active_scan','full')),
  ip_address inet,
  user_agent text,
  shared_hosting_acknowledged boolean default false,
  active boolean default true,
  revoked_at timestamptz,
  created_at timestamptz default now()
);
create index idx_consent_active on consent_records(domain_id, active) where active = true;
```

```sql
-- migrations/0007_scans.sql
create table scan_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  domain_id uuid not null references domains(id) on delete cascade,
  requested_by uuid not null references app_users(id),
  consent_record_id uuid references consent_records(id),
  type scan_type not null,
  status scan_status not null default 'queued',
  progress integer default 0 check (progress between 0 and 100),
  current_step text,
  queued_at timestamptz default now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  error_stack text,
  bull_job_id text,
  metadata jsonb default '{}'::jsonb
);
create index idx_scan_org_status on scan_jobs(organization_id, status);
create index idx_scan_domain on scan_jobs(domain_id);
create index idx_scan_queue on scan_jobs(status, queued_at);

create table scan_results (
  id uuid primary key default gen_random_uuid(),
  scan_job_id uuid not null references scan_jobs(id) on delete cascade,
  agent text not null,
  raw jsonb not null,
  created_at timestamptz default now()
);
create index idx_scan_results_job on scan_results(scan_job_id);

create table vulnerabilities (
  id uuid primary key default gen_random_uuid(),
  scan_job_id uuid not null references scan_jobs(id) on delete cascade,
  domain_id uuid not null references domains(id) on delete cascade,
  source_agent text not null,
  template_id text,
  title text not null,
  description text,
  severity severity_level not null,
  cvss_score numeric,
  cve text[],
  tags text[],
  matched_at text,
  evidence jsonb,
  ai_explanation jsonb,
  resolved_at timestamptz,
  created_at timestamptz default now()
);
create index idx_vuln_job on vulnerabilities(scan_job_id);
create index idx_vuln_domain_sev on vulnerabilities(domain_id, severity);
create index idx_vuln_tags on vulnerabilities using gin (tags);
create index idx_vuln_cve on vulnerabilities using gin (cve);
create index idx_vuln_title_trgm on vulnerabilities using gin (title gin_trgm_ops);
```

```sql
-- migrations/0008_reports_remediation.sql
create table reports (
  id uuid primary key default gen_random_uuid(),
  scan_job_id uuid not null references scan_jobs(id) on delete cascade,
  domain_id uuid not null references domains(id) on delete cascade,
  summary_hu text,
  pdf_url text,
  pdf_generated_at timestamptz,
  finding_count integer default 0,
  severity_counts jsonb default '{}'::jsonb,
  generated_at timestamptz default now()
);
create index idx_reports_job on reports(scan_job_id);

create table remediation_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  domain_id uuid not null references domains(id) on delete cascade,
  requested_by uuid not null references app_users(id),
  vulnerability_ids uuid[] not null,
  priority text check (priority in ('low','normal','high','urgent')) default 'normal',
  deadline timestamptz,
  status remediation_status default 'requested',
  admin_notes text,
  fix_suggestions jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_rem_org_status on remediation_requests(organization_id, status);
```

```sql
-- migrations/0009_audit_and_ai_usage.sql
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references app_users(id),
  actor_type actor_type default 'user',
  action text not null,
  resource_type text,
  resource_id uuid,
  ip_address inet,
  user_agent text,
  metadata jsonb,
  created_at timestamptz default now()
);
create index idx_audit_actor on audit_log(actor_id, created_at desc);
create index idx_audit_action on audit_log(action, created_at desc);
create index idx_audit_resource on audit_log(resource_type, resource_id);

-- Immutability guards
create rule audit_log_no_update as on update to audit_log do instead nothing;
create rule audit_log_no_delete as on delete to audit_log do instead nothing;

create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  scan_job_id uuid references scan_jobs(id) on delete set null,
  organization_id uuid references organizations(id) on delete set null,
  prompt_id text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(10,6),
  created_at timestamptz default now()
);
create index idx_ai_usage_org on ai_usage(organization_id, created_at desc);
```

### 5.2 Row Level Security policies

```sql
-- migrations/0010_rls.sql

-- Helper functions
create or replace function auth_org_id() returns uuid
  language sql stable security definer
as $$
  select organization_id from app_users where id = auth.uid() limit 1;
$$;

create or replace function is_admin() returns boolean
  language sql stable security definer
as $$
  select role = 'admin' from app_users where id = auth.uid() limit 1;
$$;

-- Enable RLS
alter table organizations enable row level security;
alter table app_users enable row level security;
alter table subscriptions enable row level security;
alter table domains enable row level security;
alter table domain_verifications enable row level security;
alter table consent_records enable row level security;
alter table scan_jobs enable row level security;
alter table scan_results enable row level security;
alter table vulnerabilities enable row level security;
alter table reports enable row level security;
alter table remediation_requests enable row level security;
alter table audit_log enable row level security;
alter table ai_usage enable row level security;

-- organizations: members see their own org
create policy org_members_read on organizations
  for select using (id = auth_org_id() or is_admin());
create policy org_owner_update on organizations
  for update using (
    id = auth_org_id()
    and exists (select 1 from app_users where id = auth.uid() and role in ('owner','admin'))
  );

-- app_users
create policy users_read_same_org on app_users
  for select using (organization_id = auth_org_id() or id = auth.uid() or is_admin());

-- subscriptions
create policy sub_read_own on subscriptions
  for select using (organization_id = auth_org_id() or is_admin());

-- domains
create policy domains_read on domains
  for select using (organization_id = auth_org_id() or is_admin());
create policy domains_insert on domains
  for insert with check (organization_id = auth_org_id());
create policy domains_update on domains
  for update using (organization_id = auth_org_id());
create policy domains_delete on domains
  for delete using (organization_id = auth_org_id() and is_admin());

-- domain_verifications (inherit via domain)
create policy dv_read on domain_verifications
  for select using (
    exists (select 1 from domains d where d.id = domain_id and (d.organization_id = auth_org_id() or is_admin()))
  );

-- consent_records
create policy consent_read on consent_records
  for select using (
    exists (select 1 from domains d where d.id = domain_id and (d.organization_id = auth_org_id() or is_admin()))
  );
create policy consent_insert on consent_records
  for insert with check (user_id = auth.uid());

-- scan_jobs
create policy scans_read on scan_jobs
  for select using (organization_id = auth_org_id() or is_admin());
create policy scans_insert on scan_jobs
  for insert with check (
    organization_id = auth_org_id()
    and exists (
      select 1 from domains d
      where d.id = domain_id
        and d.organization_id = auth_org_id()
        and d.verified_at is not null
        and d.verification_expires_at > now()
    )
  );

-- vulnerabilities / reports / scan_results (via scan_jobs)
create policy vulns_read on vulnerabilities
  for select using (
    exists (select 1 from scan_jobs sj where sj.id = scan_job_id and (sj.organization_id = auth_org_id() or is_admin()))
  );
create policy reports_read on reports
  for select using (
    exists (select 1 from scan_jobs sj where sj.id = scan_job_id and (sj.organization_id = auth_org_id() or is_admin()))
  );
create policy scan_results_read on scan_results
  for select using (is_admin()); -- raw output only for admins

-- remediation
create policy rem_read on remediation_requests
  for select using (organization_id = auth_org_id() or is_admin());
create policy rem_insert on remediation_requests
  for insert with check (organization_id = auth_org_id() and requested_by = auth.uid());
create policy rem_admin_update on remediation_requests
  for update using (is_admin());

-- audit_log: read only own actions (except admins)
create policy audit_read on audit_log
  for select using (actor_id = auth.uid() or is_admin());

-- ai_usage: own org or admin
create policy ai_usage_read on ai_usage
  for select using (organization_id = auth_org_id() or is_admin());
```

**Fontos:** A backend `api` app Supabase **service_role** kulccsal ír, ami megkerüli az RLS-t. Az RLS az elsődleges védelem a Supabase-hez közvetlenül csatlakozó frontend (anon key) számára. A `api` app explicit ownership check-et végez minden route-ban — **ez a defense-in-depth második rétege**.

---

## 6. Multi-Agent architektúra

Az „agent" itt nem csak LLM-et jelent — egy agent egy dedikált, jól definiált felelősségű modul, ami input-ot fogad, külső erőforrásokkal interaktál és outputot ad. A Claude API csak az AI-driven agents (`ReportGenerator`, `FixAssistant`) számára kötelező.

### 6.1 Agent 1 — DomainVerificationAgent

**Felelősség:** Bizonyítani, hogy a felhasználó a domain tulajdonosa 3 módszer egyike által.

**Helye:** `apps/worker/src/agents/domain-verification.agent.ts`

**Bemenet:** `{ domainId, method }`
**Kimenet:** `{ verified: boolean, method, evidence, reason? }`

```typescript
import { resolveTxt } from 'node:dns/promises';
import { randomBytes, createHash } from 'node:crypto';

export class DomainVerificationAgent {
  static TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
  static MAX_ATTEMPTS_PER_DAY = 20;

  constructor(
    private db: Database,
    private logger: Logger,
  ) {}

  async generateToken(domainId: string, userId: string): Promise<VerificationToken> {
    const existing = await this.db.domain_verifications.findLatestPending(domainId);
    if (existing && existing.expires_at > new Date()) {
      return { token: existing.token, expiresAt: existing.expires_at };
    }

    const token = `ehs-verify-${randomBytes(16).toString('hex')}`;
    const expiresAt = new Date(Date.now() + DomainVerificationAgent.TOKEN_TTL_SECONDS * 1000);

    await this.db.domain_verifications.insert({
      domain_id: domainId,
      token,
      status: 'pending',
      expires_at: expiresAt,
    });

    await this.db.audit_log.write({
      actor_id: userId,
      action: 'domain.verification_token_generated',
      resource_type: 'domain',
      resource_id: domainId,
    });

    return { token, expiresAt };
  }

  async verify(domainId: string, method: VerificationMethod, userId: string): Promise<VerificationResult> {
    // Rate limit check
    const attemptsToday = await this.db.domain_verifications.countAttemptsInLast24h(domainId);
    if (attemptsToday >= DomainVerificationAgent.MAX_ATTEMPTS_PER_DAY) {
      throw new RateLimitError('Too many verification attempts today');
    }

    const domain = await this.db.domains.findById(domainId);
    if (!domain) throw new NotFoundError('Domain not found');

    const pending = await this.db.domain_verifications.findLatestPending(domainId);
    if (!pending) throw new Error('No active verification token');
    if (pending.expires_at < new Date()) {
      await this.db.domain_verifications.update(pending.id, { status: 'expired' });
      throw new Error('Token expired, please generate a new one');
    }

    await this.db.domain_verifications.incrementAttempts(pending.id);

    let result: VerificationResult;
    try {
      switch (method) {
        case 'dns':  result = await this.verifyDns(domain.host, pending.token); break;
        case 'meta': result = await this.verifyMeta(domain.host, pending.token); break;
        case 'file': result = await this.verifyFile(domain.host, pending.token); break;
      }
    } catch (err) {
      result = { verified: false, method, reason: `Technical error: ${err.message}` };
    }

    if (result.verified) {
      const expiresAt = new Date(Date.now() + 365 * 24 * 3600 * 1000);
      await this.db.transaction(async (tx) => {
        await tx.domain_verifications.update(pending.id, {
          status: 'verified',
          method,
          verified_at: new Date(),
          evidence: result.evidence,
        });
        await tx.domains.update(domainId, {
          verified_at: new Date(),
          verification_method: method,
          verification_expires_at: expiresAt,
        });
      });
      await this.db.audit_log.write({
        actor_id: userId,
        action: 'domain.verified',
        resource_type: 'domain',
        resource_id: domainId,
        metadata: { method },
      });
    } else {
      await this.db.audit_log.write({
        actor_id: userId,
        action: 'domain.verification_failed',
        resource_type: 'domain',
        resource_id: domainId,
        metadata: { method, reason: result.reason },
      });
    }

    return result;
  }

  private async verifyDns(host: string, token: string): Promise<VerificationResult> {
    try {
      const records = await resolveTxt(`_ethical-scan.${host}`);
      const flat = records.flat().map(r => r.trim());
      if (flat.includes(token)) {
        return { verified: true, method: 'dns', evidence: { records: flat } };
      }
      return { verified: false, method: 'dns', reason: 'Token not found in TXT records', evidence: { records: flat } };
    } catch (err: any) {
      if (err.code === 'ENODATA' || err.code === 'ENOTFOUND') {
        return { verified: false, method: 'dns', reason: 'No TXT record at _ethical-scan subdomain' };
      }
      throw err;
    }
  }

  private async verifyMeta(host: string, token: string): Promise<VerificationResult> {
    const url = `https://${host}/`;
    const resp = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'EthicalHackApp-Verifier/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return { verified: false, method: 'meta', reason: `HTTP ${resp.status}` };
    const html = (await resp.text()).slice(0, 200_000); // cap to 200KB
    const re = /<meta\s+name=["']ethical-scan-verification["']\s+content=["']([^"']+)["']/i;
    const match = html.match(re);
    if (match && match[1] === token) {
      return { verified: true, method: 'meta', evidence: { url } };
    }
    return { verified: false, method: 'meta', reason: 'Meta tag not found or token mismatch' };
  }

  private async verifyFile(host: string, token: string): Promise<VerificationResult> {
    const url = `https://${host}/.well-known/ethical-scan-verification.txt`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) return { verified: false, method: 'file', reason: `HTTP ${resp.status}` };
    const text = (await resp.text()).trim();
    if (text === token) return { verified: true, method: 'file', evidence: { url } };
    return { verified: false, method: 'file', reason: 'File content mismatch' };
  }
}
```

**Hibakezelés:**
- DNS propagációs késés: 20 attempt/nap limit, user-nek üzenet hogy várjon
- Redirect loop: fetch `redirect:'follow'` max 20 hop default
- SSRF védelem: a host DNS-ben resolve-olva, private IP-re mutató domain-t reject (lsd. §15)

---

### 6.2 Agent 2 — PassiveScannerAgent

**Felelősség:** Minden olyan ellenőrzés, ami NEM küld exploit-payloadot a célpontra: csak normál HTTP GET/HEAD, DNS lookup, publikus metadata (WHOIS, Safe Browsing).

**Helye:** `apps/worker/src/agents/passive-scanner.agent.ts`

**Check-ek (minden külön fájl a `passive-scanner/` mappában):**
1. `ssl.check.ts` — TLS handshake, cert validity, cipher strength
2. `headers.check.ts` — CSP, HSTS, X-Frame, X-Content-Type, Referrer-Policy, Permissions-Policy, Server disclosure
3. `dns.check.ts` — SPF, DKIM, DMARC, CAA, DNSSEC
4. `robots.check.ts` — robots.txt + sitemap.xml diff, érzékeny path-ok disallow listában
5. `whois.check.ts` — domain lejárat, registrar info
6. `ports.check.ts` — legfelső 20 port TCP connect (nem full nmap, csak „nyitott-e 22/3306/5432 stb.")
7. `cms-detect.check.ts` — WordPress/Joomla/Drupal detect + verzió (`/readme.html`, generator meta, response fingerprinting)
8. `safebrowsing.check.ts` — Google Safe Browsing API lookup

**Orchestrator pseudokód:**

```typescript
export class PassiveScannerAgent {
  constructor(
    private db: Database,
    private logger: Logger,
    private emitProgress: (type: string, payload: unknown) => Promise<void>,
  ) {}

  async run(scanJobId: string, host: string): Promise<Finding[]> {
    const checks: Array<{ name: string; fn: () => Promise<Finding[]> }> = [
      { name: 'ssl',          fn: () => checkSsl(host) },
      { name: 'headers',      fn: () => checkHeaders(host) },
      { name: 'dns',          fn: () => checkDns(host) },
      { name: 'robots',       fn: () => checkRobots(host) },
      { name: 'whois',        fn: () => checkWhois(host) },
      { name: 'ports',        fn: () => checkPorts(host) },
      { name: 'cms',          fn: () => detectCms(host) },
      { name: 'safebrowsing', fn: () => checkSafeBrowsing(host) },
    ];

    const total = checks.length;
    const findings: Finding[] = [];
    let completed = 0;

    // Allow partial failures; one check failing should not abort the others.
    await Promise.all(checks.map(async (check) => {
      try {
        const checkFindings = await withTimeout(check.fn(), 30_000);
        findings.push(...checkFindings);
      } catch (err) {
        this.logger.warn({ check: check.name, err }, 'Passive check failed');
        findings.push({
          source_agent: 'passive',
          template_id: `internal.${check.name}_failed`,
          title: `${check.name} ellenőrzés nem futott le`,
          severity: 'info',
          description: `A(z) ${check.name} ellenőrzés technikai okból nem fejeződött be: ${err.message}`,
          evidence: { error: err.message },
        });
      } finally {
        completed++;
        await this.emitProgress('progress', {
          step: 'passive',
          pct: Math.floor((completed / total) * 100),
        });
      }
    }));

    // Store raw results + normalized vulns
    await this.db.scan_results.insert({
      scan_job_id: scanJobId,
      agent: 'passive',
      raw: { findings },
    });

    return findings;
  }
}
```

**SSL check részletesen (`ssl.check.ts`):**

```typescript
import * as tls from 'node:tls';

export async function checkSsl(host: string): Promise<Finding[]> {
  return new Promise((resolve) => {
    const findings: Finding[] = [];
    const socket = tls.connect({
      host, port: 443, servername: host,
      rejectUnauthorized: false,
      timeout: 10_000,
    }, () => {
      const cert = socket.getPeerCertificate(true);
      const validTo = new Date(cert.valid_to);
      const daysLeft = (validTo.getTime() - Date.now()) / 86_400_000;

      if (daysLeft < 0) {
        findings.push({
          source_agent: 'passive',
          template_id: 'ssl.expired',
          severity: 'critical',
          title: 'SSL tanúsítvány lejárt',
          description: `A tanúsítvány ${cert.valid_to} óta lejárt.`,
          evidence: { valid_to: cert.valid_to, issuer: cert.issuer?.CN },
        });
      } else if (daysLeft < 14) {
        findings.push({
          source_agent: 'passive',
          template_id: 'ssl.expiring_soon',
          severity: 'high',
          title: 'SSL tanúsítvány hamarosan lejár',
          description: `${Math.floor(daysLeft)} nap van hátra a lejáratig.`,
          evidence: { days_left: Math.floor(daysLeft), valid_to: cert.valid_to },
        });
      }

      const cipher = socket.getCipher();
      if (['TLSv1', 'TLSv1.1'].includes(cipher.version)) {
        findings.push({
          source_agent: 'passive',
          template_id: 'ssl.weak_tls_version',
          severity: 'high',
          title: 'Elavult TLS verzió támogatott',
          description: `A szerver még elfogadja a ${cipher.version} verziót, amely már nem biztonságos.`,
          evidence: { version: cipher.version, cipher: cipher.name },
        });
      }

      // Hostname mismatch?
      if (!cert.subjectaltname?.includes(`DNS:${host}`) && cert.subject?.CN !== host) {
        findings.push({
          source_agent: 'passive',
          template_id: 'ssl.hostname_mismatch',
          severity: 'medium',
          title: 'Tanúsítvány hostname eltérés',
          evidence: { cn: cert.subject?.CN, san: cert.subjectaltname },
        });
      }

      socket.end();
      resolve(findings);
    });

    socket.on('error', (err) => {
      findings.push({
        source_agent: 'passive',
        template_id: 'ssl.connection_failed',
        severity: 'medium',
        title: 'SSL kapcsolat sikertelen',
        description: `Nem sikerült SSL kapcsolatot létesíteni: ${err.message}`,
        evidence: { error: err.message },
      });
      resolve(findings);
    });

    socket.on('timeout', () => {
      socket.destroy();
      findings.push({
        source_agent: 'passive',
        template_id: 'ssl.timeout',
        severity: 'low',
        title: 'SSL kapcsolat timeout',
      });
      resolve(findings);
    });
  });
}
```

**Headers check a template_id mappingelt findings-okat állít elő (headers.check.ts) — a teljes header lista:**

| Header | Template ID | Severity ha hiányzik |
|---|---|---|
| `content-security-policy` | `headers.missing_csp` | medium |
| `strict-transport-security` | `headers.missing_hsts` | high |
| `x-frame-options` | `headers.missing_xfo` | medium |
| `x-content-type-options` | `headers.missing_xcto` | low |
| `referrer-policy` | `headers.missing_referrer` | low |
| `permissions-policy` | `headers.missing_permissions` | info |
| `server` (verzióval) | `headers.server_disclosure` | low |
| `x-powered-by` | `headers.powered_by_disclosure` | low |

---

### 6.3 Agent 3 — NucleiScannerAgent

**Felelősség:** Docker containerben futtatja a Nuclei-t izolált környezetben, streameli a progress-t, parszolja a JSONL kimenetet, normalizálja a findings-ot.

**Helye:** `apps/worker/src/agents/nuclei-scanner.agent.ts`

```typescript
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';

interface NucleiConfig {
  image: string;
  maxDurationMs: number;
  rateLimit: number;       // req/sec
  concurrency: number;     // parallel templates
  networkName: string;     // preconfigured docker network with egress-only
  tmpDir: string;          // host path for JSONL output
}

export class NucleiScannerAgent {
  private readonly ALLOWED_CATEGORIES = new Set([
    'cves', 'misconfiguration', 'exposures', 'takeovers', 'technologies', 'vulnerabilities',
  ]);

  constructor(
    private config: NucleiConfig,
    private db: Database,
    private logger: Logger,
    private emitProgress: (type: string, payload: unknown) => Promise<void>,
  ) {}

  async run(
    scanJobId: string,
    target: string,
    options: { categories: string[]; severityFilter: string[]; isSharedHosting: boolean },
  ): Promise<NucleiFinding[]> {
    // CRITICAL: validate target to prevent command injection
    if (!isValidHost(target)) {
      throw new ValidationError(`Invalid target host: ${target}`);
    }

    const categories = options.categories.filter(c => this.ALLOWED_CATEGORIES.has(c));
    if (categories.length === 0) {
      throw new ValidationError('No valid Nuclei categories provided');
    }

    const rateLimit = options.isSharedHosting
      ? Math.floor(this.config.rateLimit / 2)
      : this.config.rateLimit;

    const runId = randomUUID();
    const outputFile = path.join(this.config.tmpDir, `nuclei-${runId}.jsonl`);
    await fs.writeFile(outputFile, ''); // create empty file so bind mount works

    const dockerArgs = [
      'run', '--rm',
      '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
      '--network', this.config.networkName,
      '--memory', '1g',
      '--memory-swap', '1g',
      '--cpus', '1.0',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--user', '1000:1000',
      '-v', `${outputFile}:/output/results.jsonl:rw`,
      this.config.image,
      '-u', `https://${target}`,
      '-jsonl',
      '-o', '/output/results.jsonl',
      '-rl', String(rateLimit),
      '-c', String(this.config.concurrency),
      '-severity', options.severityFilter.join(','),
      ...categories.flatMap(c => ['-t', c]),
      '-timeout', '10',
      '-retries', '1',
      '-stats', '-si', '5',
      '-disable-update-check',
      '-no-color',
    ];

    this.logger.info({ target, runId, categories, rateLimit }, 'Starting Nuclei scan');

    const proc = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrBuffer = '';
    let killed = false;

    // Parse stderr for progress stats
    const stderrRl = readline.createInterface({ input: proc.stderr });
    stderrRl.on('line', (line) => {
      stderrBuffer += line + '\n';
      // Nuclei stats format: "[INF] Requests: 42/100 ..."
      const m = /Requests[: ]+(\d+)\/(\d+)/i.exec(line);
      if (m) {
        const done = parseInt(m[1], 10);
        const total = parseInt(m[2], 10);
        if (total > 0) {
          const pct = Math.min(99, Math.floor((done / total) * 100));
          void this.emitProgress('progress', { step: 'nuclei', pct });
        }
      }
    });

    // Hard timeout
    const timeoutHandle = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000);
    }, this.config.maxDurationMs);

    const exitCode: number | null = await new Promise((resolve, reject) => {
      proc.on('exit', (code) => resolve(code));
      proc.on('error', reject);
    });
    clearTimeout(timeoutHandle);

    if (killed) {
      await fs.unlink(outputFile).catch(() => {});
      throw new ScanTimeoutError(`Nuclei scan exceeded ${this.config.maxDurationMs}ms`);
    }

    if (exitCode !== 0 && exitCode !== null) {
      const tail = stderrBuffer.slice(-1000);
      await fs.unlink(outputFile).catch(() => {});
      throw new ScanError(`Nuclei exited with code ${exitCode}: ${tail}`);
    }

    const findings = await this.parseOutput(outputFile);
    await fs.unlink(outputFile).catch(() => {});

    // Persist raw scan_results
    await this.db.scan_results.insert({
      scan_job_id: scanJobId,
      agent: 'nuclei',
      raw: { findings, stderr_tail: stderrBuffer.slice(-2000) },
    });

    await this.emitProgress('progress', { step: 'nuclei', pct: 100 });
    return findings;
  }

  private async parseOutput(filePath: string): Promise<NucleiFinding[]> {
    const findings: NucleiFinding[] = [];
    const rl = readline.createInterface({ input: createReadStream(filePath) });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line);
        findings.push(this.normalize(raw));
      } catch (err) {
        this.logger.warn({ line, err }, 'Failed to parse Nuclei JSONL line');
      }
    }
    return findings;
  }

  private normalize(raw: any): NucleiFinding {
    return {
      source_agent: 'nuclei',
      template_id: raw['template-id'] ?? 'unknown',
      title: raw.info?.name ?? 'Unknown finding',
      description: raw.info?.description ?? null,
      severity: this.mapSeverity(raw.info?.severity),
      cvss_score: raw.info?.classification?.['cvss-score'] ?? null,
      cve: raw.info?.classification?.['cve-id'] ?? [],
      tags: raw.info?.tags ?? [],
      matched_at: raw['matched-at'] ?? null,
      evidence: {
        type: raw.type,
        host: raw.host,
        matcher_name: raw['matcher-name'],
        extracted_results: raw['extracted-results'],
        request: raw.request?.slice(0, 2000),
        response: raw.response?.slice(0, 2000),
      },
    };
  }

  private mapSeverity(s: string | undefined): Severity {
    const map: Record<string, Severity> = {
      critical: 'critical', high: 'high', medium: 'medium',
      low: 'low', info: 'info', unknown: 'info',
    };
    return map[s?.toLowerCase() ?? 'unknown'] ?? 'info';
  }
}

function isValidHost(host: string): boolean {
  // eTLD+1 or hostname, no scheme, no path
  return /^[a-z0-9][-a-z0-9.]{1,253}\.[a-z]{2,}$/i.test(host);
}
```

**Nuclei docker network setup (egyszer, setup scriptben):**

```bash
docker network create \
  --driver bridge \
  --subnet 172.30.0.0/24 \
  --opt com.docker.network.bridge.enable_icc=false \
  nuclei-outbound
```

Az `enable_icc=false` megakadályozza, hogy egyidejűleg futó scanner containerek egymással kommunikáljanak.

---

### 6.4 Agent 4 — ReportGeneratorAgent

**Felelősség:** Nyers findings → AI-magyarázott magyar jelentés → HTML → PDF → Supabase Storage.

**Helye:** `apps/worker/src/agents/report-generator.agent.ts`

**Workflow:**

```
findings (normalized)
   │
   ├─► [1] countBySeverity()  ──► severity_counts
   │
   ├─► [2] filter high+critical ──► exec_summary_input
   │     └─► Claude Sonnet (prompt: exec-summary:v1) ──► summary_hu
   │
   ├─► [3] filter high+critical (max 15) ──► enrich_input
   │     └─► Claude Sonnet (prompt: enrich-finding:v1, batched 10) ──► ai_explanations
   │
   ├─► [4] medium/low/info ──► static templates (HU texts per template_id)
   │
   ├─► [5] merge explanations ──► enriched_findings
   │
   ├─► [6] render HTML (eta template in apps/worker/src/agents/report-generator/templates/report.eta)
   │
   ├─► [7] Puppeteer → PDF buffer
   │
   ├─► [8] Supabase Storage upload (private bucket 'reports')
   │
   └─► [9] reports.insert({summary_hu, pdf_url, finding_count, severity_counts})
```

**Kulcs kódrészlet:**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import puppeteer from 'puppeteer';
import { Eta } from 'eta';

export class ReportGeneratorAgent {
  private ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  private eta = new Eta({ views: path.join(__dirname, 'report-generator/templates') });
  private readonly MODEL_FAST = 'claude-sonnet-4-6';

  async generate(scanJobId: string): Promise<ReportArtifact> {
    const scan = await this.db.scan_jobs.findById(scanJobId);
    const domain = await this.db.domains.findById(scan.domain_id);
    const findings = await this.db.vulnerabilities.findByJob(scanJobId);

    const severityCounts = countBySeverity(findings);
    const prioritized = findings
      .filter(f => ['high', 'critical'].includes(f.severity))
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

    const summaryHu = await this.generateExecSummary(domain.host, severityCounts, prioritized.slice(0, 5));
    const enrichedPriority = await this.enrichFindings(prioritized.slice(0, 15));
    const enrichedStatic = this.enrichStatic(findings.filter(f => !['high','critical'].includes(f.severity)));
    const allEnriched = [...enrichedPriority, ...enrichedStatic];

    // Persist ai_explanation per vuln
    for (const ef of enrichedPriority) {
      await this.db.vulnerabilities.update(ef.id, { ai_explanation: ef.explanation });
    }

    const html = this.eta.render('report', {
      domain, scan, summaryHu,
      findings: allEnriched,
      severityCounts,
      generatedAt: new Date(),
    });

    const pdfBuffer = await this.renderPdf(html);
    const pdfPath = `reports/${scan.organization_id}/${scanJobId}.pdf`;
    const { publicUrl } = await this.storage.upload(pdfPath, pdfBuffer, 'application/pdf');

    const report = await this.db.reports.insert({
      scan_job_id: scanJobId,
      domain_id: domain.id,
      summary_hu: summaryHu,
      pdf_url: pdfPath, // store path, generate signed URL on download
      pdf_generated_at: new Date(),
      finding_count: findings.length,
      severity_counts: severityCounts,
    });

    return { reportId: report.id, pdfPath, summary: summaryHu };
  }

  private async generateExecSummary(host: string, counts: SeverityCounts, top: Finding[]): Promise<string> {
    const msg = await this.ai.messages.create({
      model: this.MODEL_FAST,
      max_tokens: 1500,
      system: PROMPTS['exec-summary:v1'].system,
      messages: [{
        role: 'user',
        content: PROMPTS['exec-summary:v1'].userTemplate({ host, counts, top }),
      }],
    });

    await this.trackUsage(msg, 'exec-summary:v1');
    return msg.content[0].type === 'text' ? msg.content[0].text : '';
  }

  private async enrichFindings(findings: Finding[]): Promise<EnrichedFinding[]> {
    const BATCH_SIZE = 10;
    const results: EnrichedFinding[] = [];
    for (let i = 0; i < findings.length; i += BATCH_SIZE) {
      const batch = findings.slice(i, i + BATCH_SIZE);
      const enriched = await this.batchExplain(batch);
      results.push(...enriched);
    }
    return results;
  }

  private async batchExplain(findings: Finding[]): Promise<EnrichedFinding[]> {
    const msg = await this.ai.messages.create({
      model: this.MODEL_FAST,
      max_tokens: 4000,
      system: PROMPTS['enrich-finding:v1'].system,
      messages: [{
        role: 'user',
        content: PROMPTS['enrich-finding:v1'].userTemplate(findings),
      }],
    });
    await this.trackUsage(msg, 'enrich-finding:v1');

    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const cleaned = text.replace(/^```json\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const parsed: Array<{ id: string; mi_ez: string; miert_veszelyes: string; javitas: string[] }> = JSON.parse(cleaned);

    return findings.map(f => {
      const ex = parsed.find(p => p.id === f.id);
      return { ...f, explanation: ex ?? this.fallbackExplanation(f) };
    });
  }

  private async renderPdf(html: string): Promise<Buffer> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      return await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: `<div style="font-size:9px;width:100%;text-align:center;color:#666">
          <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>`,
      });
    } finally {
      await browser.close();
    }
  }

  private async trackUsage(msg: Anthropic.Message, promptId: string) {
    await this.db.ai_usage.insert({
      prompt_id: promptId,
      model: msg.model,
      input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens,
      cost_usd: calculateCost(msg.model, msg.usage),
    });
  }

  private enrichStatic(findings: Finding[]): EnrichedFinding[] {
    return findings.map(f => ({
      ...f,
      explanation: STATIC_EXPLANATIONS_HU[f.template_id] ?? {
        mi_ez: 'Ez a találat egy általános biztonsági megfigyelés.',
        miert_veszelyes: 'A hiba nem kritikus, de hosszú távon gyengíti a rendszer védelmét.',
        javitas: ['Vizsgáld felül a beállítást', 'Konzultálj a dokumentációval'],
      },
    }));
  }
}
```

---

### 6.5 Agent 5 — FixAssistantAgent

**Felelősség:** Admin oldali AI-generált javítási útmutató egy adott vulnerability-re, kontextus-függő (tech stack, CMS, szerver típus).

**Helye:** `apps/api/src/agents/fix-assistant.agent.ts` (API-ban, mert admin route-ból hívott szinkron endpoint)

```typescript
export class FixAssistantAgent {
  private ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  private readonly MODEL_SMART = 'claude-opus-4-6';

  async suggestFix(
    vulnerabilityId: string,
    context: FixContext,
    adminUserId: string,
  ): Promise<FixSuggestion> {
    const vuln = await this.db.vulnerabilities.findById(vulnerabilityId);
    if (!vuln) throw new NotFoundError('Vulnerability not found');
    const domain = await this.db.domains.findById(vuln.domain_id);

    const msg = await this.ai.messages.create({
      model: this.MODEL_SMART,
      max_tokens: 4000,
      system: PROMPTS['fix-suggestion:v1'].system,
      messages: [{
        role: 'user',
        content: PROMPTS['fix-suggestion:v1'].userTemplate({ vuln, domain, context }),
      }],
    });

    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const suggestion: FixSuggestion = {
      vulnerability_id: vulnerabilityId,
      context,
      markdown: text,
      model: msg.model,
      generated_at: new Date(),
    };

    await this.db.ai_usage.insert({
      organization_id: domain.organization_id,
      prompt_id: 'fix-suggestion:v1',
      model: msg.model,
      input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens,
      cost_usd: calculateCost(msg.model, msg.usage),
    });
    await this.db.audit_log.write({
      actor_id: adminUserId,
      actor_type: 'admin',
      action: 'fix_suggestion.generated',
      resource_type: 'vulnerability',
      resource_id: vulnerabilityId,
    });

    return suggestion;
  }
}
```

---

### 6.6 ScanProcessor — az orchestrator

**Helye:** `apps/worker/src/processors/scan.processor.ts`

```typescript
export async function scanProcessor(job: Job<ScanJobPayload>): Promise<void> {
  const { scanJobId } = job.data;
  const scan = await db.scan_jobs.findById(scanJobId);
  if (!scan) throw new Error('Scan not found');
  const domain = await db.domains.findById(scan.domain_id);

  // Defense in depth: re-check authorization at worker level
  await canScanDomain(scan.requested_by, domain.id);

  await db.scan_jobs.update(scanJobId, {
    status: 'running',
    started_at: new Date(),
    current_step: 'initializing',
  });
  await emitProgress(scanJobId, 'started', { started_at: new Date() });
  await auditLog.write({ actor_id: scan.requested_by, action: 'scan.started', resource_type: 'scan_job', resource_id: scanJobId });

  const allFindings: Finding[] = [];
  try {
    // STEP 1: Passive (always runs)
    await db.scan_jobs.update(scanJobId, { current_step: 'passive' });
    const passiveAgent = new PassiveScannerAgent(db, logger, (type, payload) => emitProgress(scanJobId, type, payload));
    const passiveFindings = await passiveAgent.run(scanJobId, domain.host);
    allFindings.push(...passiveFindings);

    // STEP 2: Active (if requested)
    if (scan.type === 'active' || scan.type === 'full') {
      await db.scan_jobs.update(scanJobId, { current_step: 'nuclei' });
      const nucleiAgent = new NucleiScannerAgent(nucleiConfig, db, logger, (type, payload) => emitProgress(scanJobId, type, payload));
      const nucleiFindings = await nucleiAgent.run(scanJobId, domain.host, {
        categories: scan.metadata?.categories ?? ['cves', 'misconfiguration', 'exposures'],
        severityFilter: ['low', 'medium', 'high', 'critical'],
        isSharedHosting: domain.is_shared_hosting,
      });
      allFindings.push(...nucleiFindings);
    }

    // Persist findings
    if (allFindings.length > 0) {
      await db.vulnerabilities.insertMany(allFindings.map(f => ({
        ...f,
        scan_job_id: scanJobId,
        domain_id: domain.id,
      })));
    }

    // STEP 3: Enqueue report generation
    await db.scan_jobs.update(scanJobId, {
      status: 'completed',
      completed_at: new Date(),
      progress: 100,
      current_step: 'done',
    });
    await reportQueue.add('report:generate', { scanJobId });
    await emitProgress(scanJobId, 'done', { status: 'completed' });
    await auditLog.write({ actor_id: scan.requested_by, action: 'scan.completed', resource_type: 'scan_job', resource_id: scanJobId });
  } catch (err: any) {
    await db.scan_jobs.update(scanJobId, {
      status: 'failed',
      error_message: err.message,
      error_stack: err.stack?.slice(0, 4000),
      completed_at: new Date(),
    });
    await emitProgress(scanJobId, 'done', { status: 'failed', error: err.message });
    await auditLog.write({ actor_id: scan.requested_by, action: 'scan.failed', resource_type: 'scan_job', resource_id: scanJobId, metadata: { error: err.message } });
    throw err; // let BullMQ retry per defaultJobOptions
  }
}
```

---

## 7. API endpointok

Minden endpoint prefixe `/api/v1`. Auth: `Authorization: Bearer <supabase_jwt>` kivéve ahol jelölve.

### 7.1 Auth / user / org

| Method | Path | Auth | Request body | Response |
|---|---|---|---|---|
| POST | `/auth/register-org` | Bearer | `{ name, billingEmail }` | `{ org, user }` |
| GET | `/auth/me` | Bearer | — | `{ user, org, subscription }` |
| POST | `/auth/2fa/enable` | Bearer | `{ totp_code }` | `{ enabled: true }` |
| POST | `/auth/2fa/disable` | Bearer + 2FA | `{ totp_code }` | `{ enabled: false }` |

### 7.2 Domains

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/domains` | Bearer | `?page=&limit=` | `{ data: Domain[], total }` |
| POST | `/domains` | Bearer | `{ host, is_shared_hosting }` | `Domain` |
| GET | `/domains/:id` | Bearer | — | `Domain & { verifications: [] }` |
| DELETE | `/domains/:id` | Bearer (admin role) | — | `204` |

### 7.3 Domain verification

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/domains/:id/verification` | Bearer | — | `{ token, expiresAt, instructions: {dns, meta, file} }` |
| POST | `/domains/:id/verification/check` | Bearer | `{ method: 'dns'\|'meta'\|'file' }` | `VerificationResult` |
| GET | `/domains/:id/verification` | Bearer | — | `{ current, history }` |

### 7.4 Scans

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/scans` | Bearer | `{ domainId, type, consent: { tosVersion, sharedHostingAck } }` | `ScanJob` |
| GET | `/scans` | Bearer | `?domainId=&status=&page=&limit=` | `{ data: ScanJob[], total }` |
| GET | `/scans/:id` | Bearer | — | `ScanJob & { domain, findings_summary }` |
| DELETE | `/scans/:id` | Bearer | — | `204` (only if queued/running) |
| GET | `/scans/:id/stream` | Bearer | — | `text/event-stream` |

### 7.5 Vulnerabilities

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/scans/:id/vulnerabilities` | Bearer | `?severity=&search=&page=` | `{ data: Vuln[], total }` |
| GET | `/vulnerabilities/:id` | Bearer | — | `Vuln & { explanation }` |

### 7.6 Reports

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/scans/:id/report` | Bearer | — | `Report` |
| GET | `/scans/:id/report/pdf` | Bearer | — | `302` redirect to signed URL (60s TTL) |
| POST | `/scans/:id/report/regenerate` | Bearer (admin) | — | `202 Accepted` |

### 7.7 Remediation

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/remediation` | Bearer | `{ vulnerabilityIds, priority, deadline, notes }` | `RemediationRequest` |
| GET | `/remediation` | Bearer | `?status=&page=` | `{ data, total }` |
| GET | `/remediation/:id` | Bearer | — | `RemediationRequest` |

### 7.8 Billing

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/billing/subscription` | Bearer | — | `Subscription` |
| POST | `/billing/checkout` | Bearer | `{ tier }` | `{ url }` |
| POST | `/billing/portal` | Bearer | — | `{ url }` |
| POST | `/webhooks/stripe` | **none** (Stripe sig) | Stripe event | `200` |

### 7.9 Admin

Route-prefix `/admin`, előfeltétel: `is_admin=true` + 2FA enabled.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/admin/scans` | `?orgId=&status=` | `ScanJob[]` |
| GET | `/admin/queue` | — | `{ waiting, active, completed, failed, delayed }` |
| POST | `/admin/scans/:id/restart` | — | `202` |
| POST | `/admin/scans/:id/cancel` | — | `202` |
| POST | `/admin/vulnerabilities/:id/fix-suggestion` | `{ context: { cms, server_type, tech_stack } }` | `FixSuggestion` |
| GET | `/admin/remediation` | `?status=` | `RemediationRequest[]` |
| PATCH | `/admin/remediation/:id` | `{ status, admin_notes }` | `RemediationRequest` |
| GET | `/admin/audit-log` | `?actorId=&resourceType=&from=&to=` | `AuditEntry[]` |
| POST | `/admin/domains/:id/force-verify` | `{ reason }` | `Domain` |

### 7.10 GDPR

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/gdpr/export` | Bearer | — | `202` (async email) |
| POST | `/gdpr/delete` | Bearer + 2FA | `{ confirm: 'DELETE' }` | `202` |

### 7.11 Health

| Method | Path | Response |
|---|---|---|
| GET | `/health` | `{ status, version, uptime, checks: { db, redis, docker } }` |

### 7.12 Közös response formátum

```typescript
// Success
{ data: T, meta?: { page, limit, total } }

// Error
{
  error: {
    code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'RATE_LIMIT' | 'INTERNAL',
    message: string,
    details?: unknown,
    request_id: string,
  }
}
```

### 7.13 Rate limiting

Globális (per IP + per user):
- Default: 100 req/min
- Scan indítás: 5 scan / 15 min / org
- Verification check: 20 / day / domain
- Login attempt: 5 / 15 min / IP

Implementáció: `@fastify/rate-limit` Redis backenddel.

---

## 8. Mappastruktúra

```
ethical-hack-app/
├── package.json                    # workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── docker-compose.yml              # dev
├── docker-compose.prod.yml         # prod reference
├── .env.example
├── .gitignore
├── README.md
├── docs/
│   ├── IMPLEMENTATION_PLAN.md      # this file
│   ├── RUNBOOK.md                  # ops, incident response
│   └── API.md                      # OpenAPI exported
│
├── apps/
│   ├── web/                        # Next.js 14
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── globals.css
│   │   │   ├── (marketing)/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx                    # landing
│   │   │   │   ├── pricing/page.tsx
│   │   │   │   ├── legal/tos/page.tsx
│   │   │   │   └── legal/privacy/page.tsx
│   │   │   ├── (auth)/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── login/page.tsx
│   │   │   │   ├── register/page.tsx
│   │   │   │   └── verify-email/page.tsx
│   │   │   ├── (app)/
│   │   │   │   ├── layout.tsx                  # app shell + auth guard
│   │   │   │   ├── dashboard/page.tsx
│   │   │   │   ├── domains/
│   │   │   │   │   ├── page.tsx
│   │   │   │   │   ├── new/page.tsx
│   │   │   │   │   └── [id]/
│   │   │   │   │       ├── page.tsx
│   │   │   │   │       └── verify/page.tsx
│   │   │   │   ├── scans/
│   │   │   │   │   ├── page.tsx
│   │   │   │   │   ├── new/page.tsx
│   │   │   │   │   └── [id]/
│   │   │   │   │       ├── page.tsx             # live progress + results
│   │   │   │   │       ├── report/page.tsx
│   │   │   │   │       └── vulnerabilities/[vulnId]/page.tsx
│   │   │   │   ├── remediation/
│   │   │   │   │   ├── page.tsx
│   │   │   │   │   └── new/page.tsx
│   │   │   │   ├── billing/page.tsx
│   │   │   │   └── settings/
│   │   │   │       ├── page.tsx
│   │   │   │       └── 2fa/page.tsx
│   │   │   ├── (admin)/
│   │   │   │   ├── layout.tsx                   # admin guard + 2FA check
│   │   │   │   ├── admin/page.tsx
│   │   │   │   ├── admin/scans/page.tsx
│   │   │   │   ├── admin/queue/page.tsx
│   │   │   │   ├── admin/vulnerabilities/[id]/page.tsx
│   │   │   │   ├── admin/remediation/page.tsx
│   │   │   │   ├── admin/remediation/[id]/page.tsx
│   │   │   │   └── admin/audit/page.tsx
│   │   │   └── api/
│   │   │       └── health/route.ts              # lightweight Next-side probe
│   │   ├── components/
│   │   │   ├── ui/                              # shadcn
│   │   │   ├── scan/
│   │   │   │   ├── scan-progress.tsx
│   │   │   │   ├── severity-badge.tsx
│   │   │   │   ├── finding-card.tsx
│   │   │   │   └── findings-table.tsx
│   │   │   ├── domain/
│   │   │   │   ├── verification-wizard.tsx
│   │   │   │   └── domain-card.tsx
│   │   │   ├── report/
│   │   │   │   └── exec-summary.tsx
│   │   │   ├── admin/
│   │   │   │   ├── queue-stats.tsx
│   │   │   │   └── fix-suggestion-panel.tsx
│   │   │   └── layout/
│   │   │       ├── app-sidebar.tsx
│   │   │       ├── admin-sidebar.tsx
│   │   │       └── header.tsx
│   │   ├── lib/
│   │   │   ├── api-client.ts                    # typed client
│   │   │   ├── supabase-browser.ts
│   │   │   ├── supabase-server.ts
│   │   │   ├── i18n/
│   │   │   │   ├── index.ts
│   │   │   │   ├── hu.json
│   │   │   │   └── en.json
│   │   │   └── utils.ts
│   │   ├── hooks/
│   │   │   ├── use-scan-stream.ts
│   │   │   ├── use-user.ts
│   │   │   └── use-toast.ts
│   │   ├── middleware.ts                        # auth routing gate
│   │   ├── next.config.mjs
│   │   ├── tailwind.config.ts
│   │   ├── postcss.config.js
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── api/                        # Fastify backend
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── app.ts                           # Fastify instance factory
│   │   │   ├── config.ts                        # zod-parsed env
│   │   │   ├── plugins/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── rate-limit.ts
│   │   │   │   ├── audit.ts
│   │   │   │   ├── sse.ts
│   │   │   │   ├── error-handler.ts
│   │   │   │   ├── cors.ts
│   │   │   │   └── sensible.ts
│   │   │   ├── routes/
│   │   │   │   ├── index.ts                     # route registration
│   │   │   │   ├── auth.routes.ts
│   │   │   │   ├── domains.routes.ts
│   │   │   │   ├── verification.routes.ts
│   │   │   │   ├── scans.routes.ts
│   │   │   │   ├── vulnerabilities.routes.ts
│   │   │   │   ├── reports.routes.ts
│   │   │   │   ├── remediation.routes.ts
│   │   │   │   ├── billing.routes.ts
│   │   │   │   ├── webhooks.routes.ts
│   │   │   │   ├── admin.routes.ts
│   │   │   │   ├── gdpr.routes.ts
│   │   │   │   └── health.routes.ts
│   │   │   ├── services/
│   │   │   │   ├── domain.service.ts
│   │   │   │   ├── scan.service.ts
│   │   │   │   ├── queue.service.ts
│   │   │   │   ├── billing.service.ts
│   │   │   │   ├── stripe.service.ts
│   │   │   │   ├── audit.service.ts
│   │   │   │   └── authorization.service.ts    # canScanDomain etc.
│   │   │   ├── agents/
│   │   │   │   └── fix-assistant.agent.ts
│   │   │   ├── db/
│   │   │   │   ├── client.ts                    # postgres.js + supabase-js
│   │   │   │   └── repositories/
│   │   │   │       ├── domains.repo.ts
│   │   │   │       ├── scans.repo.ts
│   │   │   │       ├── vulnerabilities.repo.ts
│   │   │   │       ├── reports.repo.ts
│   │   │   │       ├── remediation.repo.ts
│   │   │   │       ├── users.repo.ts
│   │   │   │       ├── consent.repo.ts
│   │   │   │       └── audit.repo.ts
│   │   │   ├── lib/
│   │   │   │   ├── logger.ts
│   │   │   │   ├── errors.ts
│   │   │   │   ├── validation.ts
│   │   │   │   ├── signed-url.ts
│   │   │   │   └── ssrf-guard.ts
│   │   │   └── types/
│   │   │       └── fastify.d.ts
│   │   ├── test/
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   └── fixtures/
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── worker/                     # BullMQ consumers
│       ├── src/
│       │   ├── worker.ts                        # bootstrap
│       │   ├── config.ts
│       │   ├── queues/
│       │   │   ├── scan.queue.ts
│       │   │   ├── report.queue.ts
│       │   │   └── verification.queue.ts
│       │   ├── processors/
│       │   │   ├── scan.processor.ts
│       │   │   ├── report.processor.ts
│       │   │   └── verification.processor.ts
│       │   ├── agents/
│       │   │   ├── domain-verification.agent.ts
│       │   │   ├── passive-scanner.agent.ts
│       │   │   ├── passive-scanner/
│       │   │   │   ├── ssl.check.ts
│       │   │   │   ├── headers.check.ts
│       │   │   │   ├── dns.check.ts
│       │   │   │   ├── robots.check.ts
│       │   │   │   ├── whois.check.ts
│       │   │   │   ├── ports.check.ts
│       │   │   │   ├── cms-detect.check.ts
│       │   │   │   └── safebrowsing.check.ts
│       │   │   ├── nuclei-scanner.agent.ts
│       │   │   ├── report-generator.agent.ts
│       │   │   ├── report-generator/
│       │   │   │   ├── templates/
│       │   │   │   │   ├── report.eta
│       │   │   │   │   └── partials/
│       │   │   │   ├── static-explanations-hu.ts
│       │   │   │   └── pdf.ts
│       │   │   └── prompts/
│       │   │       ├── index.ts
│       │   │       ├── exec-summary.ts
│       │   │       ├── enrich-finding.ts
│       │   │       └── fix-suggestion.ts
│       │   └── lib/
│       │       ├── docker.ts
│       │       ├── claude.ts
│       │       ├── storage.ts
│       │       ├── emit-progress.ts
│       │       └── cost-calculator.ts
│       ├── test/
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   ├── shared-types/
│   │   ├── src/
│   │   │   ├── scan.ts
│   │   │   ├── vulnerability.ts
│   │   │   ├── domain.ts
│   │   │   ├── report.ts
│   │   │   ├── finding.ts
│   │   │   ├── prompts.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── db-schema/
│   │   ├── migrations/
│   │   │   ├── 0001_extensions.sql
│   │   │   ├── 0002_types.sql
│   │   │   ├── 0003_organizations.sql
│   │   │   ├── 0004_subscriptions.sql
│   │   │   ├── 0005_domains.sql
│   │   │   ├── 0006_consent.sql
│   │   │   ├── 0007_scans.sql
│   │   │   ├── 0008_reports_remediation.sql
│   │   │   ├── 0009_audit_and_ai_usage.sql
│   │   │   └── 0010_rls.sql
│   │   ├── seed/
│   │   │   └── dev_seed.sql
│   │   └── package.json
│   │
│   └── ui/                          # shared React components (optional)
│       └── src/
│
├── docker/
│   ├── api.Dockerfile
│   ├── worker.Dockerfile
│   ├── web.Dockerfile
│   └── nuclei-network.sh            # docker network create script
│
├── scripts/
│   ├── setup-dev.sh
│   ├── run-migrations.ts
│   ├── seed-dev.ts
│   └── create-admin.ts
│
└── .github/
    └── workflows/
        ├── ci.yml                    # lint + typecheck + test
        └── deploy.yml                # Railway deploy on main
```

---

## 9. Docker Compose (dev)

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ethicalhack_dev
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: docker/api.Dockerfile
      target: dev
    env_file: .env
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    ports:
      - "4000:4000"
    volumes:
      - ./apps/api:/app/apps/api
      - ./packages:/app/packages
      - /app/apps/api/node_modules
    command: pnpm --filter @eha/api dev

  worker:
    build:
      context: .
      dockerfile: docker/worker.Dockerfile
      target: dev
    env_file: .env
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    volumes:
      - ./apps/worker:/app/apps/worker
      - ./packages:/app/packages
      - /app/apps/worker/node_modules
      - /var/run/docker.sock:/var/run/docker.sock  # dev only; scanner spawn
      - scanner_tmp:/tmp/scanner
    environment:
      SCANNER_TMP_DIR: /tmp/scanner
    command: pnpm --filter @eha/worker dev

  web:
    build:
      context: .
      dockerfile: docker/web.Dockerfile
      target: dev
    env_file: .env
    depends_on: [api]
    ports:
      - "3000:3000"
    volumes:
      - ./apps/web:/app/apps/web
      - ./packages:/app/packages
      - /app/apps/web/node_modules
    command: pnpm --filter @eha/web dev

  bull-board:
    image: deadly0/bull-board:latest
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379
    depends_on: [redis]
    ports:
      - "4001:3000"

networks:
  default:
    driver: bridge
  scanner-net:
    name: nuclei-outbound
    driver: bridge
    driver_opts:
      com.docker.network.bridge.enable_icc: "false"

volumes:
  pg_data:
  redis_data:
  scanner_tmp:
```

**Setup script (`scripts/setup-dev.sh`):**

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "==> Creating nuclei-outbound docker network..."
docker network inspect nuclei-outbound >/dev/null 2>&1 || \
  docker network create --driver bridge \
    --opt com.docker.network.bridge.enable_icc=false \
    nuclei-outbound

echo "==> Pulling Nuclei image..."
docker pull projectdiscovery/nuclei:v3.2.0

echo "==> Installing deps..."
pnpm install

echo "==> Running migrations..."
pnpm --filter @eha/db-schema migrate

echo "==> Seeding dev data..."
pnpm --filter @eha/db-schema seed

echo "==> Done. Run 'docker compose up' to start."
```

---

## 10. Environment változók

```bash
# =========================
# Core
# =========================
NODE_ENV=development                 # development|staging|production
LOG_LEVEL=info                       # debug|info|warn|error
CURRENT_TOS_VERSION=2026-04-01       # bump on legal text changes

# =========================
# Web (Next.js)
# =========================
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_POSTHOG_KEY=             # analytics (optional)

# =========================
# API (Fastify)
# =========================
API_HOST=0.0.0.0
API_PORT=4000
API_JWT_SECRET=                      # for any internal tokens (32+ bytes)
API_CORS_ORIGINS=http://localhost:3000
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=           # server-side only, NEVER in web!
SUPABASE_JWT_SECRET=                 # for verifying user JWTs
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ethicalhack_dev

# =========================
# Redis / BullMQ
# =========================
REDIS_URL=redis://redis:6379
BULL_CONCURRENCY=3
BULL_RATE_LIMIT_MAX=10
BULL_RATE_LIMIT_DURATION_MS=60000

# =========================
# Anthropic Claude
# =========================
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL_FAST=claude-sonnet-4-6
ANTHROPIC_MODEL_SMART=claude-opus-4-6
ANTHROPIC_MAX_RETRIES=3

# =========================
# Nuclei Scanner
# =========================
NUCLEI_IMAGE=projectdiscovery/nuclei:v3.2.0
NUCLEI_MAX_DURATION_MS=1800000       # 30 minutes hard cap
NUCLEI_RATE_LIMIT=100                # req/sec default
NUCLEI_CONCURRENCY=10                # parallel templates
NUCLEI_NETWORK_NAME=nuclei-outbound
SCANNER_TMP_DIR=/tmp/scanner         # host path for JSONL output
DOCKER_SOCKET=/var/run/docker.sock

# =========================
# Stripe
# =========================
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO=price_xxx
STRIPE_PRICE_BUSINESS=price_yyy
STRIPE_PUBLIC_KEY=                   # NEXT_PUBLIC prefix if used client-side

# =========================
# Email (Resend)
# =========================
RESEND_API_KEY=
FROM_EMAIL=noreply@yourdomain.hu
REPLY_TO_EMAIL=support@yourdomain.hu

# =========================
# Storage
# =========================
SUPABASE_STORAGE_BUCKET=reports      # private bucket
SIGNED_URL_TTL_SECONDS=60

# =========================
# Observability
# =========================
SENTRY_DSN=
AXIOM_TOKEN=
AXIOM_DATASET=eha-prod

# =========================
# External APIs (optional)
# =========================
GOOGLE_SAFEBROWSING_API_KEY=
SHODAN_API_KEY=                      # optional, if Shodan instead of local port scan
```

**Env parsing (`apps/api/src/config.ts`):**

```typescript
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(32),
  SUPABASE_JWT_SECRET: z.string().min(32),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
  CURRENT_TOS_VERSION: z.string(),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
  // ... etc
});

export const config = schema.parse(process.env);
```

A `config.parse()` fail-fast startupnál, ha bármi hiányzik vagy rossz.

---

## 11. BullMQ konfiguráció

### 11.1 Queue definíciók

```typescript
// apps/worker/src/queues/scan.queue.ts
import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

export const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const scanQueue = new Queue<ScanJobPayload>('scans', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 7 * 86400, count: 1000 },
    removeOnFail: { age: 14 * 86400, count: 500 },
  },
});

export const reportQueue = new Queue<ReportJobPayload>('reports', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 7 * 86400 },
    removeOnFail: { age: 30 * 86400 },
  },
});

export const verificationQueue = new Queue<VerificationJobPayload>('verifications', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 30_000 },
    removeOnComplete: { count: 100 },
  },
});
```

### 11.2 Worker bootstrap

```typescript
// apps/worker/src/worker.ts
import { Worker } from 'bullmq';
import { connection } from './queues/scan.queue';
import { scanProcessor } from './processors/scan.processor';
import { reportProcessor } from './processors/report.processor';
import { verificationProcessor } from './processors/verification.processor';
import { logger } from './lib/logger';

async function main() {
  const scanWorker = new Worker('scans', scanProcessor, {
    connection,
    concurrency: parseInt(process.env.BULL_CONCURRENCY ?? '3', 10),
    limiter: {
      max: parseInt(process.env.BULL_RATE_LIMIT_MAX ?? '10', 10),
      duration: parseInt(process.env.BULL_RATE_LIMIT_DURATION_MS ?? '60000', 10),
    },
  });

  const reportWorker = new Worker('reports', reportProcessor, {
    connection,
    concurrency: 2,
  });

  const verificationWorker = new Worker('verifications', verificationProcessor, {
    connection,
    concurrency: 5,
  });

  for (const [name, worker] of [['scan', scanWorker], ['report', reportWorker], ['verification', verificationWorker]] as const) {
    worker.on('completed', (job) => logger.info({ queue: name, jobId: job.id }, 'Job completed'));
    worker.on('failed', (job, err) => logger.error({ queue: name, jobId: job?.id, err }, 'Job failed'));
    worker.on('error', (err) => logger.error({ queue: name, err }, 'Worker error'));
  }

  logger.info('Worker started');

  const shutdown = async () => {
    logger.info('Shutting down workers...');
    await Promise.all([scanWorker.close(), reportWorker.close(), verificationWorker.close()]);
    await connection.quit();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'Worker bootstrap failed');
  process.exit(1);
});
```

### 11.3 Job típusok

| Queue | Job name | Payload | Processor |
|---|---|---|---|
| `scans` | `scan:orchestrate` | `{ scanJobId }` | `scanProcessor` (runs passive+active) |
| `reports` | `report:generate` | `{ scanJobId }` | `reportProcessor` (calls ReportGeneratorAgent) |
| `verifications` | `verification:check` | `{ domainId, method, userId }` | `verificationProcessor` |

---

## 12. SSE progress stream

### 12.1 API oldal (Fastify)

```typescript
// apps/api/src/routes/scans.routes.ts
import IORedis from 'ioredis';

export async function scansRoutes(fastify: FastifyInstance) {
  fastify.get('/scans/:id/stream', {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await scanService.assertOwnership(id, req.user.id);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send current state
    const job = await scanService.findById(id);
    send('state', {
      status: job.status,
      progress: job.progress,
      step: job.current_step,
    });

    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      send('done', { status: job.status });
      reply.raw.end();
      return;
    }

    // Subscribe to Redis pub/sub
    const sub = new IORedis(process.env.REDIS_URL!);
    await sub.subscribe(`scan:${id}`);

    sub.on('message', (_channel, message) => {
      try {
        const evt = JSON.parse(message);
        send(evt.type, evt.payload);
        if (evt.type === 'done') {
          reply.raw.end();
          void sub.quit();
        }
      } catch (err) {
        req.log.warn({ err }, 'Invalid SSE message');
      }
    });

    // Heartbeat every 15s
    const heartbeat = setInterval(() => {
      reply.raw.write(`: heartbeat\n\n`);
    }, 15_000);

    // Cleanup on disconnect
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      void sub.quit();
    });
  });
}
```

### 12.2 Worker emit

```typescript
// apps/worker/src/lib/emit-progress.ts
import IORedis from 'ioredis';

const pub = new IORedis(process.env.REDIS_URL!);

export async function emitProgress(scanJobId: string, type: string, payload: unknown) {
  await pub.publish(`scan:${scanJobId}`, JSON.stringify({ type, payload }));
  // Also persist progress to DB for late subscribers
  if (type === 'progress' && typeof (payload as any)?.pct === 'number') {
    await db.scan_jobs.update(scanJobId, {
      progress: (payload as any).pct,
      current_step: (payload as any).step,
    });
  }
}
```

### 12.3 Kliens (React hook)

```typescript
// apps/web/hooks/use-scan-stream.ts
import { useEffect, useState } from 'react';

export type ScanStreamState = {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  step: string | null;
  error?: string;
};

export function useScanStream(scanId: string, token: string): ScanStreamState {
  const [state, setState] = useState<ScanStreamState>({
    status: 'queued', progress: 0, step: null,
  });

  useEffect(() => {
    const url = `${process.env.NEXT_PUBLIC_API_URL}/api/v1/scans/${scanId}/stream`;
    // Native EventSource doesn't support custom headers — use fetch-based polyfill
    // or a short-lived token appended as query param (validated server-side).
    const es = new EventSource(`${url}?access_token=${token}`);

    es.addEventListener('state', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setState(s => ({ ...s, ...data }));
    });
    es.addEventListener('progress', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setState(s => ({ ...s, progress: data.pct, step: data.step }));
    });
    es.addEventListener('done', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setState(s => ({ ...s, status: data.status, error: data.error }));
      es.close();
    });
    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [scanId, token]);

  return state;
}
```

**Biztonsági megjegyzés:** az `access_token` query paramban átadás kockázatos (URL log, referrer leak). Alternatíva: short-lived one-time token endpoint (`POST /scans/:id/stream-token`) ami egy 60s TTL-ű cookie-t vagy tokent ad, és csak ehhez a scan-hez érvényes.

---

## 13. Claude API prompt registry

```typescript
// apps/worker/src/agents/prompts/index.ts
export const PROMPTS = {
  'exec-summary:v1': execSummaryPrompt,
  'enrich-finding:v1': enrichFindingPrompt,
  'fix-suggestion:v1': fixSuggestionPrompt,
} as const;
```

### 13.1 `exec-summary:v1`

```typescript
// apps/worker/src/agents/prompts/exec-summary.ts
export const execSummaryPrompt = {
  id: 'exec-summary:v1',
  model: 'claude-sonnet-4-6',
  maxTokens: 1500,
  system: `Te egy kiberbiztonsági szakértő vagy, aki magyar nyelven ír érthető, nem túl technikai összefoglalót cégvezetők számára. Ne használj túlzó jelzőket mint "azonnali katasztrófa" vagy "totális összeomlás". Légy tárgyilagos, világos, konstruktív. Az olvasó nem fejlesztő, hanem döntéshozó. A cél, hogy a vezető megértse mi történt, mi a kockázat, és milyen üzleti döntést kell hoznia.

Kerülendő szavak: "katasztrofális", "halálos", "végzetes", "totális".
Használatos szavak: "fokozott kockázat", "javasolt beavatkozás", "érdemes prioritással kezelni".

Sosem említsd: konkrét CVE számokat, template ID-kat, command injectiont részletesen.`,
  userTemplate: ({ host, counts, top }: { host: string; counts: SeverityCounts; top: Finding[] }) => `Készíts executive summary-t a(z) **${host}** domain biztonsági vizsgálatáról.

## Találatok megoszlása
- Kritikus: ${counts.critical}
- Magas: ${counts.high}
- Közepes: ${counts.medium}
- Alacsony: ${counts.low}
- Információs: ${counts.info}

## Legfontosabb találatok (top 5)
${top.map((f, i) => `${i + 1}. [${f.severity}] ${f.title}
   Rövid leírás: ${(f.description ?? '').slice(0, 200)}`).join('\n\n')}

## Elvárt válasz formátum (Markdown, magyarul)

### Összegzés
(2-3 mondat az általános állapotról)

### Főbb kockázatok
- (3-5 pont üzleti nyelven, nem technikailag)

### Javasolt lépések
1. (azonnali: 0-7 nap)
2. (rövid távú: 1-4 hét)
3. (közép távú: 1-3 hónap)

### Megjegyzés
(1-2 mondat arról, hogy a szolgáltató milyen segítséget tud nyújtani)`,
};
```

### 13.2 `enrich-finding:v1`

```typescript
export const enrichFindingPrompt = {
  id: 'enrich-finding:v1',
  model: 'claude-sonnet-4-6',
  maxTokens: 4000,
  system: `Sérülékenységek magyar nyelvű, gyakorlatias magyarázatát adod. A célközönség magyar fejlesztők és rendszergazdák, akik nem biztos, hogy jártasak biztonsági témákban.

Minden találathoz PONTOSAN 3 mezőt adsz:
1. "mi_ez": 2-3 mondat magyarul arról, mit jelent ez a találat egyszerű szavakkal
2. "miert_veszelyes": 2-3 mondat az üzleti ÉS technikai hatásról (mi történhet ha nem javítjuk)
3. "javitas": 3-5 pontos, konkrét, kivitelezhető lépéssor (ne általánosságok, hanem konkrét akciók)

A válaszod KIZÁRÓLAG egy valid JSON tömb lesz, minden elem ezzel a struktúrával:
{ "id": "<input_id>", "mi_ez": "...", "miert_veszelyes": "...", "javitas": ["lépés 1", "lépés 2", ...] }

Semmilyen bevezető vagy záró szöveget ne írj, csak a JSON tömböt. Ne használj markdown code fence-t.`,
  userTemplate: (findings: Finding[]) => `Magyarázd el az alábbi ${findings.length} találatot.

${JSON.stringify(
    findings.map(f => ({
      id: f.id,
      title: f.title,
      severity: f.severity,
      description: f.description?.slice(0, 500),
      template_id: f.template_id,
      cve: f.cve,
      evidence: f.evidence,
    })),
    null, 2
  )}`,
};
```

### 13.3 `fix-suggestion:v1`

```typescript
export const fixSuggestionPrompt = {
  id: 'fix-suggestion:v1',
  model: 'claude-opus-4-6',
  maxTokens: 4000,
  system: `Senior security engineer vagy. Egy admin kolléga adott vulnerability-hez konkrét, azonnal alkalmazható javítást kér tőled. A javítást a szolgáltató fogja elvégezni az ügyfél szerverén (előzetes megbízás alapján).

Strukturáld a választ a következő szekciókra (Markdown):

## Diagnózis
(2-3 mondat: pontosan mi a probléma és miért sérülékeny)

## Érintett komponens
- Fájl/config: (melyik fájlt vagy beállítást kell módosítani)
- Technológia: (amit használnak)

## Javítás lépésről lépésre
1. ...
2. ...
3. ...
(adj KONKRÉT kódot/configot, ne pszeudót; ha szükséges, külön code block-ban)

## Ellenőrzés a javítás után
- [ ] Mit kell tesztelni
- [ ] Milyen outputot vársz
- [ ] Hogyan tudjuk igazolni hogy a hiba megszűnt

## Kockázatok a javítás során
(ha van bármi, amire oda kell figyelni — pl. downtime, adatvesztés, kompatibilitás)

## Ha a kontextus hiányos
Ha nincs elég infó a pontos javításhoz, tegyél fel konkrét tisztázó kérdéseket a végén a "Kérdések" szekcióban.`,
  userTemplate: ({ vuln, domain, context }: { vuln: Vulnerability; domain: Domain; context: FixContext }) => `## Környezet
- Domain: ${domain.host}
- Szerver típus: ${context.server_type ?? 'ismeretlen'}
- CMS: ${context.cms ?? 'ismeretlen'}
- Tech stack: ${context.tech_stack?.join(', ') ?? 'ismeretlen'}
- Shared hosting: ${domain.is_shared_hosting ? 'igen' : 'nem'}

## Sérülékenység
- Cím: ${vuln.title}
- Súlyosság: ${vuln.severity}
- Template ID: ${vuln.template_id}
- Leírás: ${vuln.description ?? '-'}
- CVE: ${vuln.cve?.length ? vuln.cve.join(', ') : '-'}
- Evidence:
\`\`\`json
${JSON.stringify(vuln.evidence, null, 2)}
\`\`\`

## Kérés
Generálj konkrét javítási útmutatót a fenti kontextus alapján.`,
};
```

### 13.4 Prompt verziózás

Minden prompt-nak verziója van a suffix-ben (`:v1`, `:v2`). Ha a promptot változtatod:
1. Ne írd felül, hanem hozz létre `:v2`-t
2. A/B tesztelhető (fele forgalom az új verzióra)
3. `ai_usage.prompt_id` oszlop verzió-tracking-hez

---

## 14. Hibakezelési stratégia

### 14.1 Hibakategóriák

| Kategória | Példa | Érintett komponens | User-látható? |
|---|---|---|---|
| Validation | Rossz domain formátum | API | 400 + mező |
| Auth | Hibás/lejárt JWT | API | 401 |
| Authorization | Más org domain-jére scan | API + Worker | 403 |
| Not found | Nincs ilyen scan | API | 404 |
| Rate limit | Túl sok scan | API | 429 + retry-after |
| External service | Claude API down | Worker | degraded report |
| Scanner timeout | Nuclei 30 min | Worker | scan = failed |
| Scanner crash | Docker OOM | Worker | scan = failed, partial OK |
| DB down | Supabase outage | API + Worker | 503 |
| Redis down | BullMQ unavailable | API + Worker | 503 |

### 14.2 Scan crash forgatókönyvek (részletesen)

**1. Nuclei container OOM / SIGKILL**
- Detect: `proc.on('exit', code !== 0)`
- Action: scan_jobs.status = failed, error = "Scanner ran out of memory"
- BullMQ retry 2× exponential backoff
- Ha még mindig fail: scan véglegesen failed, de a **passive findings megmaradnak**
- Report generálódik a meglévő findings-ból, metadata.partial = true

**2. Docker daemon nem elérhető**
- Detect: `spawn` ENOENT vagy docker health check fail
- Action: worker health = unhealthy → Railway restart
- Job marad queued (nincs consume)
- Alert Sentry + PagerDuty (ha van)

**3. Claude API 5xx / rate limit**
- SDK auto-retry 3× exponential (30s, 60s, 120s)
- Ha véglegesen fail:
  - Exec summary → fallback hardcoded template magyar szöveggel ("A részletes AI-összegzés átmeneti technikai hiba miatt nem érhető el, kérjük próbálja újra 1 óra múlva.")
  - Enrichment → static explanations (severity-alapú template-ek)
- Report mégis generálódik, metadata.ai_degraded = true

**4. Supabase down**
- Detect: connection timeout vagy 503
- API health endpoint 503
- Worker pause (nem consume-olja a job-ot)
- Frontend retry UI: "A szolgáltatás átmenetileg nem elérhető, próbálja újra..."

**5. Target nem elérhető mid-scan**
- Nuclei 5-10 timeout egymás után → Nuclei graceful exit
- scan_jobs.status = completed (degraded), metadata = { partial: true, reason: 'target_unreachable' }
- Ügyfél látja a jelentésben: "A vizsgálat közben a szerver átmenetileg nem válaszolt"

**6. Verification token mid-scan lejárt**
- A worker-ben `canScanDomain()` újra fut minden scan elején
- Ha lejárt: scan cancelled, error = "Domain verification expired"
- Audit log-ba

**7. User mid-scan cancelled**
- DELETE /scans/:id → BullMQ `job.moveToFailed()` + flag
- Worker a `scan.status === 'cancelled'` ellenőrzést a step-ek között futtatja
- Nuclei proc SIGTERM, cleanup

### 14.3 Globális error handler (Fastify)

```typescript
// apps/api/src/plugins/error-handler.ts
import { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export function errorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: FastifyError, req, reply) => {
    const requestId = req.id;

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'Invalid request', details: error.errors, request_id: requestId },
      });
    }
    if (error.name === 'UnauthorizedError') {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', request_id: requestId } });
    }
    if (error.name === 'ForbiddenError') {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: error.message, request_id: requestId } });
    }
    if (error.name === 'NotFoundError') {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: error.message, request_id: requestId } });
    }
    if (error.name === 'RateLimitError' || error.statusCode === 429) {
      return reply.status(429).send({ error: { code: 'RATE_LIMIT', message: 'Too many requests', request_id: requestId } });
    }

    // Unknown error: log + Sentry
    req.log.error({ err: error, requestId }, 'Unhandled error');
    Sentry.captureException(error, { tags: { request_id: requestId } });

    return reply.status(500).send({
      error: { code: 'INTERNAL', message: 'Internal server error', request_id: requestId },
    });
  });
}
```

### 14.4 Worker hibakezelés

A BullMQ processzor `throw`-ja kiváltja a retry-t a `defaultJobOptions.attempts` szerint. Minden exception logolva, Sentry-be küldve.

```typescript
worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Job failed');
  Sentry.captureException(err, {
    tags: { queue: job?.queueName, jobName: job?.name },
    extra: { jobData: job?.data },
  });
});
```

---

## 15. Biztonsági követelmények (saját platform)

### 15.1 Threat model — top kockázatok

| # | Fenyegetés | Hatás | Kontroll |
|---|---|---|---|
| T1 | Ügyfél szkenneltet egy nem-övé domain-t → jogi felelősség | Súlyos (büntetőjogi) | Verification + consent + audit log |
| T2 | Scanner exploit → worker host compromise | Súlyos | Docker read-only, cap drop, network isolation, no-new-privileges |
| T3 | Command injection a target paraméterből | Súlyos | Strict allowlist regex `isValidHost()` |
| T4 | SSRF passive scanner-ben | Közepes | SSRF guard: private IP range block, DNS resolve check |
| T5 | Admin credential leak | Súlyos | 2FA kötelező admin-nak, audit log |
| T6 | Report PDF-ben más ügyfél adatai | GDPR breach | Signed URL 60s TTL, RLS enforced on read |
| T7 | Redis pub/sub eavesdrop | Közepes | SSE ownership check, channel per scan_id |
| T8 | Stripe webhook spoofing | Pénzügyi | Signature verify a route-on |
| T9 | API key leak (Anthropic, Stripe) | Súlyos | Only server-side, secret rotation rendszer |
| T10 | Brute force login | Közepes | Rate limit IP+email, 2FA upsell |

### 15.2 Docker sandbox részletei

Minden Nuclei container futtatás kötelező flagekkel:

```bash
docker run --rm \
  --read-only \                                  # root FS immutable
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \      # scratch dir, no exec
  --network nuclei-outbound \                    # egress-only bridge
  --memory 1g --memory-swap 1g \                 # no swap escape
  --cpus 1.0 \                                   # CPU cap
  --cap-drop ALL \                               # drop all caps
  --security-opt no-new-privileges \             # no setuid escalation
  --user 1000:1000 \                             # non-root uid
  -v /host/tmp/scanner/xxx.jsonl:/output/results.jsonl:rw \
  projectdiscovery/nuclei:v3.2.0 ...
```

**Production ajánlás:** sysbox vagy gVisor runtime a dedicated scanner node-on, egyedi kernel namespaces.

### 15.3 SSRF védelem passive scanner-ben

A PassiveScannerAgent minden HTTP kérést csak a verifikált domain-re küldhet. Az `fetch` wrapperében:

```typescript
// apps/worker/src/lib/safe-fetch.ts
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

const PRIVATE_RANGES = [
  '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
  '127.0.0.0/8', '169.254.0.0/16', '::1/128', 'fc00::/7',
];

export async function safeFetch(targetHost: string, path: string, init?: RequestInit): Promise<Response> {
  const { address } = await lookup(targetHost);
  const ip = ipaddr.parse(address);
  for (const range of PRIVATE_RANGES) {
    const [netAddr, prefix] = range.split('/');
    if (ip.match(ipaddr.parse(netAddr), parseInt(prefix, 10))) {
      throw new Error(`SSRF blocked: ${targetHost} resolves to private IP ${address}`);
    }
  }
  return fetch(`https://${targetHost}${path}`, init);
}
```

### 15.4 Titkosítás

- **In transit:** TLS 1.3 everywhere (Railway managed certs)
- **At rest:**
  - Database: Supabase default (AES-256 at storage layer)
  - Scan results + reports: Supabase Storage private bucket, at-rest encrypted
  - Sensitive fields (e.g. Stripe customer ID): storing reference only, actual data at Stripe
- **Secrets:** Railway secret manager; never committed; rotated 90 naponta

### 15.5 2FA admin kötelezés

Admin route-ok előfeltétele:
1. `is_admin() = true`
2. `app_users.totp_enabled = true`
3. Aktuális session-ben 2FA elapsed < 15 perc (re-prompt)

```typescript
fastify.register(adminRoutes, {
  prefix: '/api/v1/admin',
  preHandler: [fastify.authenticate, fastify.requireAdmin, fastify.require2FA],
});
```

### 15.6 GDPR

**Adattárolási retenció:**
- `scan_results` (raw): 90 nap, scheduled job DELETE `created_at < now() - interval '90 days'`
- `vulnerabilities`: 12 hónap
- `reports`: 12 hónap + Supabase Storage object lifecycle policy
- `audit_log`: 3 év (jogi követelmény)
- `ai_usage`: 12 hónap (cost tracking)

**Törlési kérelem folyamat:**
1. User `/gdpr/delete` endpoint hívás (2FA required)
2. 14 napos soft-delete (visszaállítható, email confirmation)
3. 14 nap után: org + minden domain + scan + vuln cascade delete
4. `audit_log` rekordok megtartva, de `actor_id → null`, `user_email` pseudonymized

**Export kérelem:**
1. User `/gdpr/export` endpoint hívás
2. Async job: ZIP fájl generálása (JSON: user, org, domains, scans, vulns, reports listája)
3. Signed download URL email-ben, 7 napos TTL

### 15.7 Rate limit táblázat

| Action | Limit | Window | Scope |
|---|---|---|---|
| Global API | 100 req | 1 min | IP |
| Login | 5 attempt | 15 min | IP+email |
| Password reset | 3 | 1 hour | email |
| Register | 3 | 1 hour | IP |
| Scan start | Tier-dependent | 1 month | org |
| Verification check | 20 | 24 hours | domain |
| Report download | 30 | 1 hour | user |
| GDPR export | 1 | 24 hours | user |
| Admin API | 500 req | 1 min | user |

---

## 16. Fizetési modell

### 16.1 Csomagok

| Csomag | Ár (HUF/hó) | Domain | Scan/hó | Scanner típus | PDF jelentés | Javítási támogatás | Prioritás |
|---|---|---|---|---|---|---|---|
| **Free** | 0 | 1 | 1 passzív | passive only | alap (AI summary nélkül) | ❌ | alacsony |
| **Pro** | 9 990 | 3 | 4 | passive + active | igen, AI-enriched | email support | normál |
| **Business** | 29 990 | 10 | korlátlan* | passive + active + full | igen, AI-enriched + whitelabel | dedikált admin | magas (queue priority) |

*A "korlátlan" fair use alapon: max 2 futó scan párhuzamosan, max 1 scan / domain / óra.

### 16.2 Stripe integráció

**Flow:**
1. User `/billing/checkout` → backend `stripe.checkout.sessions.create()` → redirect URL
2. User fizet → Stripe redirect success_url = `/billing/success?session_id=...`
3. Stripe webhook → `POST /api/v1/webhooks/stripe`
4. Backend updateli `subscriptions` táblát az event alapján

**Lehallgatandó webhook event-ek:**
- `checkout.session.completed` → subscription aktív
- `customer.subscription.updated` → tier vagy period változás
- `customer.subscription.deleted` → cancelled
- `invoice.payment_failed` → email notification, tier → free ha 3× fail
- `invoice.payment_succeeded` → audit log

### 16.3 Webhook handler

```typescript
// apps/api/src/routes/webhooks.routes.ts
fastify.post('/webhooks/stripe', {
  config: { rawBody: true },
}, async (req, reply) => {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody!, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return reply.status(400).send('Webhook signature verification failed');
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata!.organization_id;
      await db.subscriptions.upsert({
        organization_id: orgId,
        tier: tierFromPriceId(session.metadata!.price_id),
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
        status: 'active',
      });
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      await db.subscriptions.update(
        { stripe_subscription_id: sub.id },
        {
          tier: tierFromPriceId(sub.items.data[0].price.id),
          current_period_start: new Date(sub.current_period_start * 1000),
          current_period_end: new Date(sub.current_period_end * 1000),
          status: sub.status,
        },
      );
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await db.subscriptions.update({ stripe_subscription_id: sub.id }, { tier: 'free', status: 'cancelled' });
      break;
    }
    case 'invoice.payment_failed': {
      // Email notification + audit log
      break;
    }
  }

  reply.status(200).send({ received: true });
});
```

### 16.4 Quota enforcement

```typescript
// apps/api/src/services/authorization.service.ts
export async function canStartScan(orgId: string, scanType: ScanType): Promise<void> {
  const sub = await db.subscriptions.findByOrg(orgId);
  const tier = sub?.tier ?? 'free';

  const limits: Record<SubscriptionTier, { scansPerMonth: number; allowActive: boolean; domains: number }> = {
    free:     { scansPerMonth: 1,  allowActive: false, domains: 1 },
    pro:      { scansPerMonth: 4,  allowActive: true,  domains: 3 },
    business: { scansPerMonth: 999, allowActive: true, domains: 10 },
  };
  const lim = limits[tier];

  if (scanType !== 'passive' && !lim.allowActive) {
    throw new ForbiddenError('Active scans require Pro or Business subscription');
  }

  const monthStart = startOfMonth(new Date());
  const scansThisMonth = await db.scan_jobs.countSince(orgId, monthStart);
  if (scansThisMonth >= lim.scansPerMonth) {
    throw new ForbiddenError(`Monthly scan limit reached (${lim.scansPerMonth})`);
  }

  const domainCount = await db.domains.countByOrg(orgId);
  if (domainCount > lim.domains) {
    throw new ForbiddenError(`Domain limit exceeded for ${tier} tier`);
  }
}
```

---

## 17. UI/UX képernyők

### 17.1 Landing (`/`)

**Célközönség:** magyar KKV tulajdonos/IT döntéshozó, nem biztos hogy ismeri a "pentest" szót.

**Szekciók:**
1. Hero — "Etikus hacker a weboldaladért, automata módban" + "3 perc alatt megtudhatod, mennyire védett az oldalad"
2. Hogyan működik (3 lépés, ikonok): Regisztrálj → Igazold a domain-t → Kapj magyar jelentést
3. Mit vizsgálunk (grid: SSL, header-ek, CVE-k, konfig, CMS biztonság)
4. Jogi és etikai keret (kiemelt szekció): "Minden vizsgálat csak tulajdonosi beleegyezéssel. Btk. 423. § szerint."
5. Árazás
6. GYIK
7. Footer (ToS, Privacy, kapcsolat)

**CTA:** "Ingyenes első vizsgálat" → `/register`

### 17.2 Regisztráció (`/register`)

Form mezők:
- Teljes név
- Email
- Jelszó (min 12 karakter, követelmények)
- Cégnév (organization)
- Számlázási email
- [ ] Elfogadom a ToS v2026-04-01 (kötelező)
- [ ] Elfogadom az Adatkezelési tájékoztatót (kötelező)

Submit → Supabase Auth signup → `consent_records` insert → redirect `/dashboard`

### 17.3 Dashboard (`/dashboard`)

**Komponensek:**
- Welcome banner (first-time tutorial overlay)
- Quick stats: domain count, scan count, open findings count
- "Next steps" checklist:
  - [x] Regisztrálva
  - [ ] Add hozzá az első domain-t
  - [ ] Igazold a domain-t
  - [ ] Indítsd az első vizsgálatot
- Recent scans táblázat (last 5)
- Severity overview doughnut chart (org-level)

### 17.4 Domain hozzáadás (`/domains/new`)

Form:
- Domain host (pl. `example.com`) — input, validation: eTLD+1 regex
- "A domain megosztott hosting környezetben fut?" — Igen / Nem / Nem tudom
  - Ha "Igen": alert banner "A megosztott hosting környezetben a vizsgálat rate limit-je szigorúbb"
- Megjegyzés (optional)

Submit → `POST /domains` → redirect `/domains/:id/verify`

### 17.5 Verification wizard (`/domains/:id/verify`)

**Tab-ok:**

**DNS TXT (ajánlott)**
```
Add hozzá a következő TXT rekordot a DNS-hez:

Név:    _ethical-scan.example.com
Típus:  TXT
Érték:  ehs-verify-a3f8b7c9d2e1f6...  [copy]

Várj 1-2 percet a DNS propagációra, majd kattints:
[Ellenőrzés most]
```

**HTML meta tag**
```
Helyezd el a következő meta tag-et a <head> szekcióba:

<meta name="ethical-scan-verification" content="ehs-verify-..."> [copy]

[Ellenőrzés most]
```

**Fájl feltöltés**
```
Töltsd fel a következő fájlt:

URL:   https://example.com/.well-known/ethical-scan-verification.txt
Tartalom:  ehs-verify-a3f8b7c9...  [copy]

[Ellenőrzés most]
```

**Állapot panel:**
- Legutóbbi kísérletek listája (timestamp, method, status, reason if failed)
- Token lejárat countdown

**Siker:** toast notification + redirect `/domains/:id`

### 17.6 Scan indítása (`/scans/new`)

```
Domain kiválasztása: [dropdown, csak verifikált domain-ek]

Vizsgálat típusa:
  ○ Passzív (ingyenes, csak publikus info)
  ○ Aktív (Nuclei, Pro+)
  ● Teljes (passzív + aktív, Pro+)

[collapsible: Haladó beállítások]
  Nuclei kategóriák:
    [x] CVE-k
    [x] Hibás konfiguráció
    [x] Kitett erőforrások
    [ ] Subdomain takeover-ek
    [x] Technológiák

⚠ Jogi nyilatkozat (olvasd el figyelmesen)
─────────────────────────────────────────
A sérülékenységvizsgálat csak a domain tulajdonosának explicit beleegyezésével végezhető (Btk. 423. §). A vizsgálat megrendelésével Ön kijelenti, hogy jogosult engedélyezni a vizsgálatot.
─────────────────────────────────────────

[ ] Elolvastam és elfogadom a Felhasználási feltételeket (v2026-04-01)
[ ] Kijelentem, hogy jogosult vagyok a megadott domain vizsgálatának engedélyezésére

[Vizsgálat indítása]   (disabled amíg mindkét checkbox nincs)
```

Submit → `POST /scans` → redirect `/scans/:id`

### 17.7 Scan progress + results (`/scans/:id`)

**Running állapotban:**
```
Vizsgálat folyamatban — example.com
─────────────────────────────────────────
[████████░░] 80%  — Nuclei templates futtatása

Lépések:
  ✓ Sor várakozás
  ✓ Passzív vizsgálat (1m 23s)
  ● Aktív vizsgálat (3m 45s / ~10m)
  ○ Jelentés generálás
─────────────────────────────────────────
[Részletes napló ▾]
[Vizsgálat leállítása]
```

**Completed állapotban:**
- Severity overview chipek: 🔴 2 Kritikus · 🟠 5 Magas · 🟡 12 Közepes · 🟢 8 Alacsony · ℹ 3 Infó
- Executive summary (AI-generált magyar szöveg, collapsible card)
- "PDF letöltése" gomb (primary)
- "Javítás megrendelése" gomb (secondary)
- Findings táblázat:
  - Oszlopok: Súlyosság, Cím, Kategória (tag), Matched at
  - Sor kattintás → drawer vagy `/vulnerabilities/:id`
  - Szűrés: severity multi-select, keresés input
  - Rendezés: severity, cím, kategória

### 17.8 Vulnerability detail drawer/page

```
[Kritikus] SSL tanúsítvány lejárt
─────────────────────────────────────────

📖 Mi ez?
Az oldal SSL tanúsítványa nem érvényes többé. A böngészők figyelmeztető üzenetet
fognak mutatni a látogatóknak, és az oldal használhatatlan lesz a legtöbb ügyfél számára.

⚠ Miért veszélyes?
A lejárt tanúsítvány miatt a látogatók elhagyják az oldalt, a keresőmotorok visszasorolják,
és az ügyfelek adatai sem biztonságosak a titkosítás hiánya miatt.

🔧 Mit kell tenni?
1. Keresd meg a tanúsítványkibocsátót (pl. Let's Encrypt, DigiCert, stb.)
2. Igényelj új tanúsítványt vagy újíts meg a jelenlegit
3. Telepítsd a tanúsítványt a web szerverre
4. Indítsd újra a szervert
5. Ellenőrizd https://www.ssllabs.com/ssltest oldalon

📎 Technikai részletek [▾ collapsed]
  template_id: ssl.expired
  evidence: { valid_to: "2026-03-15T00:00:00Z", issuer: "Let's Encrypt" }

🔗 Referenciák
  - https://letsencrypt.org/getting-started/
  - https://www.ssllabs.com/ssltest/
```

CTA: "Rendelj javítást" checkbox → hozzáadja a selectelt vuln-ok listájához

### 17.9 PDF jelentés layout

**Oldalak:**
1. **Cover** — szolgáltató logo, domain, scan date, report ID
2. **Tartalomjegyzék**
3. **Executive summary** (AI magyar)
4. **Súlyossági áttekintés** (bar chart + táblázat)
5. **Kritikus találatok** (detailed, 1/oldal)
6. **Magas találatok** (detailed)
7. **Közepes találatok** (condensed, 2-3/oldal)
8. **Alacsony + info** (táblázatos)
9. **Módszertan** (mit vizsgáltunk, mit nem)
10. **Jogi nyilatkozat** (ToS ref, Btk. 423. §)
11. **Kapcsolat** (support email, website)

Design: egyszerű, monospace számok, kék accent szín, nyomtatóbarát.

### 17.10 Remediation megrendelés (`/remediation/new`)

```
Javítás megrendelése
─────────────────────────────────────────

Válaszd ki a találatokat:
  [x] [Kritikus] SSL tanúsítvány lejárt
  [x] [Magas] Hiányzó HSTS header
  [ ] [Közepes] Elavult TLS verzió támogatott
  ... (all from last scan)

Prioritás:
  ○ Alacsony (7 napon belül)
  ● Normál (3 napon belül)
  ○ Magas (24 órán belül)
  ○ Sürgős (pontos határidő megadása)

Határidő: [2026-04-18]  (optional)

Megjegyzés a szolgáltatónak:
[textarea]

⚠ Javítás a Pro+ csomagban elérhető.
   Ár: egyedi ajánlat alapján.

[Megrendelés küldése]
```

### 17.11 Billing (`/billing`)

- Aktuális csomag card
- Upgrade/downgrade gombok
- "Számlázási portál" link → Stripe Customer Portal
- Használat overview: scans/month progress bar, domains count
- Számlatörténet táblázat (Stripe invoice list)

### 17.12 Settings

- Profile: név, email, jelszó
- 2FA beállítás (TOTP QR code flow)
- Szervezet: cégnév, számlázási email (owner only)
- API keys (opcionális, Business csomagban)
- GDPR: "Adataim exportálása", "Fiók törlése" (destructive, 2FA required)

---

## 18. Admin felület

Külön route: `/admin`, védett (is_admin + 2FA).

### 18.1 `/admin` — Dashboard

- Live stats: aktív scan-ek, queue waiting/active/failed counts
- Elmúlt 24 óra statok: új reg., új scan, új remediation
- Live error feed (utolsó 10 failed job)
- AI usage / cost overview (today, this month)

### 18.2 `/admin/scans`

- Táblázat minden scan-ről org szűrővel
- Oszlopok: org, domain, type, status, queued_at, duration, findings_count
- Row actions: View, Cancel, Restart

### 18.3 `/admin/queue`

- Bull Board iframe embed `http://localhost:4001` (vagy auth proxy-val)
- Queue health metrikák

### 18.4 `/admin/vulnerabilities/:id`

Részletes vuln page + admin-only panel:

```
[🪄 Generate AI Fix Suggestion]

Context:
  Server type: [dropdown: Apache/Nginx/IIS/ismeretlen]
  CMS: [dropdown: WordPress/Joomla/Drupal/ismeretlen]
  Tech stack: [multi-input tags]

[Generate]
─────────────────────────────────────────
(AI fix suggestion markdown render, editable)
[Save as remediation note]
```

### 18.5 `/admin/remediation`

- Táblázat: status, priority, deadline, vulns count
- Row actions: Assign, Start, Complete
- Details page: full vuln list, AI fix suggestions, progress tracking

### 18.6 `/admin/audit`

- Filter: actor, action, resource, date range
- Table: timestamp, actor, action, resource, IP, metadata
- Export CSV

### 18.7 `/admin/domains/:id/force-verify`

- Form: reason textarea (kötelező, audit log-ba kerül)
- Confirmation modal
- "Ez csak akkor alkalmazható, ha minden szokásos verification módszer dokumentáltan kudarcot vall és a tulajdonjog más úton igazolt."

---

## 19. Fázisolási terv

Solo developer + AI-assisted (Claude Code), reális tempó.

### Fázis 0 — Alapok (2-3 nap)

**Kimenet:**
- Monorepo (pnpm + Turborepo) felhúzva
- Docker Compose dev env működik
- Supabase projekt létrehozva, `packages/db-schema` migrációk alkalmazva
- Next.js + Fastify + Worker skeleton (Hello World endpointok)
- GitHub Actions CI: lint + typecheck + test
- Sentry integráció mindhárom appban
- `scripts/setup-dev.sh` fut végigcsavarral

**Függőségek:**
- Supabase projekt létrehozva
- Anthropic API key meglett
- Stripe test account
- Railway account

**Tesztelhetőség:**
- `docker compose up` → mindhárom service elindul
- `curl localhost:4000/api/v1/health` → 200 `{ status: ok }`
- Next.js `/` → "Hello World"
- Worker logban: "Worker started"

**Becsült idő:** 2-3 nap

---

### Fázis 1 — Auth + Domain + Verification (4-6 nap)

**Kimenet:**
- Supabase Auth flow (register/login/logout)
- Organization létrehozás auto a registrationnél
- `/dashboard`, `/domains`, `/domains/new` pages
- `POST /domains` + `GET /domains` + `GET /domains/:id`
- `DomainVerificationAgent` mindhárom módszerrel (DNS, meta, file)
- Verification wizard frontend
- `consent_records` insert ToS elfogadásnál
- `audit_log` minden kritikus eseményre
- Rate limit plugin

**Függőségek:** Fázis 0

**Tesztelhetőség:**
- Saját teszt domainen (pl. `testdomain.example.hu`) mindhárom verification módszer sikerrel lefut
- `audit_log` táblában ellenőrizhető a teljes flow
- Rate limit: 21. verification check 429-et ad 24 órán belül

**Becsült idő:** 4-6 nap

---

### Fázis 2 — Passive Scanner + SSE (4-6 nap)

**Kimenet:**
- `PassiveScannerAgent` minden check-kel (SSL, headers, DNS, robots, WHOIS, ports, CMS, Safe Browsing)
- BullMQ scan queue + worker
- Scan indítás UI (consent checkbox, tier-agnostic)
- SSE progress stream (API + React hook)
- Results dashboard severity szűrővel
- Vulnerability detail drawer (AI enrichment NÉLKÜL, csak raw)
- `canScanDomain()` authorization check mindkét helyen

**Függőségek:** Fázis 1

**Tesztelhetőség:**
- Passzív scan lefut 30-60 másodperc alatt
- SSE progress real-time frissül a UI-ban
- Ismerten hibás SSL domain (pl. `expired.badssl.com`) kritikus találatot ad
- Hiányzó HSTS header-t detektál

**Becsült idő:** 4-6 nap

---

### Fázis 3 — Nuclei Active Scanner (5-7 nap)

**Kimenet:**
- `NucleiScannerAgent` Docker spawnal
- `nuclei-outbound` network + setup script
- Rate limiting (normal vs shared hosting)
- Stderr progress parsing
- JSONL normalize → `vulnerabilities` insert
- Scan típus választó UI (passive / active / full)
- Nuclei categories haladó beállítás
- Pro tier gate + error message ha free user active-t próbál
- Hard timeout + cleanup

**Függőségek:** Fázis 2; Docker socket access a workernek

**Tesztelhetőség:**
- Szándékosan sérülékeny célpont (OWASP Juice Shop vagy DVWA docker) ellen futtatva talál ismert CVE-t
- 30 perc után automatikus cancel
- Nuclei crash → scan failed, de passive findings megmaradnak
- Rate limit 50 req/s shared hosting domain-re

**Becsült idő:** 5-7 nap

---

### Fázis 4 — AI Reporting (3-5 nap)

**Kimenet:**
- `ReportGeneratorAgent`
- Exec summary prompt (Sonnet)
- Batch enrichment prompt (Sonnet)
- Static HU explanations táblázat medium/low/info-ra
- HTML template (`report.eta`)
- Puppeteer PDF render
- Supabase Storage upload (private bucket)
- Signed URL download endpoint
- Vulnerability detail page AI magyarázattal
- `ai_usage` cost tracking

**Függőségek:** Fázis 2 (vulnerabilities léteznek)

**Tesztelhetőség:**
- Completed scan PDF-je 30s alatt generálódik
- Magyar szöveg érthető, nem tartalmaz "katasztrofikus" kifejezéseket
- AI usage tábla kitöltődik
- Signed URL 60s után lejár

**Becsült idő:** 3-5 nap

---

### Fázis 5 — Billing + Limits (3-4 nap)

**Kimenet:**
- Stripe Checkout integráció
- Webhook handler minden event-re
- `subscriptions` tábla populated
- `canStartScan()` quota enforcement
- Billing page (current tier, upgrade, portal link)
- Tier gate UI messages

**Függőségek:** Fázis 4

**Tesztelhetőség:**
- Stripe test mode teljes flow: checkout → sub active → scan engedélyezett
- Free user cannot start active scan (403)
- Webhook spoofing 400-at ad (rossz signature)
- Canceled sub → tier → free, meglévő adatok megmaradnak

**Becsült idő:** 3-4 nap

---

### Fázis 6 — Admin + Fix Assistant (3-5 nap)

**Kimenet:**
- Admin route guard (is_admin + 2FA)
- Admin dashboard live stats
- Bull Board embed
- `FixAssistantAgent` (Opus)
- Fix suggestion UI panel
- Remediation workflow (requested → completed)
- Audit log viewer
- Force verify override

**Függőségek:** Fázis 5

**Tesztelhetőség:**
- Admin login → 2FA prompt → admin pages elérhetőek
- Fix suggestion generálódik egy test vuln-ra
- Remediation status changes audit log-ba írva

**Becsült idő:** 3-5 nap

---

### Fázis 7 — Polish, Legal, Deploy (4-6 nap)

**Kimenet:**
- Landing page végleges
- ToS + Privacy text **jogász által review-zott**
- GDPR export/delete implementálva
- Email template-ek (Resend)
- Rate limit finomhangolás
- Load test (k6): 100 concurrent SSE, 10 parallel scans
- Error budget monitoring
- Railway deployment (api, worker, web + custom domain)
- Supabase production projekt
- Monitoring dashboard (Sentry + Axiom)
- Runbook dokumentum (`docs/RUNBOOK.md`)

**Függőségek:** Fázis 6 + jogász review

**Tesztelhetőség:**
- Élesben az első fizető teszt ügyfél tud regisztrálni → verify → scan → pay → letölteni → remediation megrendelni
- Load test nem töri el (p95 latency < 500ms)
- Sentry errors < 1% requests

**Becsült idő:** 4-6 nap

---

### Teljes idővonal

| Fázis | Nap | Kumulatív |
|---|---|---|
| 0 | 2-3 | 2-3 |
| 1 | 4-6 | 6-9 |
| 2 | 4-6 | 10-15 |
| 3 | 5-7 | 15-22 |
| 4 | 3-5 | 18-27 |
| 5 | 3-4 | 21-31 |
| 6 | 3-5 | 24-36 |
| 7 | 4-6 | 28-42 |

**Reális MVP (első fizető ügyfél):** 5-6 hét kb. 30 munkanappal, kevés buffer.

**Prioritás ha csúszás van:**
1. Fázis 3 (Nuclei) elhagyható MVP-ből — passive-only launch is valid
2. Fázis 6 (Fix assistant) elhagyható — manuális admin workflow elég
3. Fázis 5 (Billing) NEM elhagyható — nincs revenue nélküle

---

## 20. Függelékek

### 20.1 Kulcs TypeScript típusok (`packages/shared-types`)

```typescript
// packages/shared-types/src/index.ts
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type ScanType = 'passive' | 'active' | 'full';
export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type VerificationMethod = 'dns' | 'meta' | 'file';
export type SubscriptionTier = 'free' | 'pro' | 'business';

export interface Finding {
  id?: string;
  source_agent: 'passive' | 'nuclei';
  template_id: string;
  title: string;
  description?: string | null;
  severity: Severity;
  cvss_score?: number | null;
  cve?: string[];
  tags?: string[];
  matched_at?: string | null;
  evidence?: Record<string, unknown>;
}

export interface EnrichedFinding extends Finding {
  explanation: {
    mi_ez: string;
    miert_veszelyes: string;
    javitas: string[];
  };
}

export interface Domain {
  id: string;
  organization_id: string;
  host: string;
  verified_at: Date | null;
  verification_method: VerificationMethod | null;
  verification_expires_at: Date | null;
  is_shared_hosting: boolean;
}

export interface ScanJob {
  id: string;
  organization_id: string;
  domain_id: string;
  requested_by: string;
  type: ScanType;
  status: ScanStatus;
  progress: number;
  current_step: string | null;
  queued_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  error_message: string | null;
}

export interface FixContext {
  server_type?: 'apache' | 'nginx' | 'iis' | 'unknown';
  cms?: 'wordpress' | 'joomla' | 'drupal' | 'unknown';
  tech_stack?: string[];
}

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}
```

### 20.2 Severity rank helper

```typescript
export function severityRank(s: Severity): number {
  return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[s];
}
export function countBySeverity(findings: Finding[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}
```

### 20.3 Cost calculator

```typescript
// apps/worker/src/lib/cost-calculator.ts
const PRICING: Record<string, { input: number; output: number }> = {
  // USD per 1M tokens
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-6': { input: 15, output: 75 },
};

export function calculateCost(model: string, usage: { input_tokens: number; output_tokens: number }): number {
  const p = PRICING[model] ?? { input: 0, output: 0 };
  return (usage.input_tokens * p.input + usage.output_tokens * p.output) / 1_000_000;
}
```

### 20.4 Static HU explanations (példa)

```typescript
// apps/worker/src/agents/report-generator/static-explanations-hu.ts
export const STATIC_EXPLANATIONS_HU: Record<string, { mi_ez: string; miert_veszelyes: string; javitas: string[] }> = {
  'headers.missing_csp': {
    mi_ez: 'A Content-Security-Policy egy olyan HTTP header, ami megmondja a böngészőnek, milyen forrásokból tölthet be tartalmat (JavaScript, kép, stb.). Ennek hiányában a böngésző bármit betölt, ami a szerveren szerepel.',
    miert_veszelyes: 'CSP hiányában egy támadó XSS sebezhetőség révén könnyebben tud kártékony JavaScriptet injektálni, ami ellop jelszavakat vagy cookie-kat. Ez a modern böngészők egyik leghatékonyabb XSS elleni védelme.',
    javitas: [
      'Nyisd meg a webszerver konfigurációját (Apache: .htaccess vagy vhost, Nginx: server block)',
      'Adj hozzá egy Content-Security-Policy header-t, pl: Content-Security-Policy: default-src \'self\'; script-src \'self\'',
      'Teszteld először Report-Only módban (Content-Security-Policy-Report-Only) hogy ne törjön el semmi',
      'Finomítsd a szabályt a szükséges külső források (Google Fonts, CDN) hozzáadásával',
      'Ha kész, válts élesre (Content-Security-Policy)',
    ],
  },
  'headers.missing_hsts': {
    mi_ez: 'A HSTS (HTTP Strict Transport Security) header arra utasítja a böngészőt, hogy az adott domain-t mindig HTTPS-en keresztül érje el, soha ne HTTP-n.',
    miert_veszelyes: 'HSTS nélkül egy támadó man-in-the-middle támadással eltérítheti a HTTP kapcsolatot, mielőtt az HTTPS-re váltana. Ez különösen veszélyes nyilvános Wi-Fi hálózatokon.',
    javitas: [
      'Biztosítsd hogy az oldal érvényes SSL tanúsítvánnyal rendelkezik',
      'Add hozzá a header-t a webszerver konfigurációjához',
      'Javasolt érték: Strict-Transport-Security: max-age=31536000; includeSubDomains',
      'Ha biztos vagy benne, add hozzá a preload direktívát is, majd submit-old a hstspreload.org oldalon',
    ],
  },
  // ... további template_id-k
};
```

### 20.5 Minimum Railway deploy konfiguráció

**Services:**
1. `eha-api` (Node.js, Dockerfile)
2. `eha-worker` (Node.js + Docker-in-Docker, külön node)
3. `eha-web` (Next.js)
4. `redis` (Railway plugin)
5. Supabase külön projekt (managed)

**Private networking:** api ↔ worker ↔ redis ugyanazon Railway private network-en, csak web publikus.

**Custom domain:** `app.yourdomain.hu` → web, `api.yourdomain.hu` → api

### 20.6 Nuclei template kategória referencia

A worker a Nuclei community templates-et használja, az allowlist:
- `cves/` — ismert CVE-k
- `misconfiguration/` — hibás konfigurációk
- `exposures/` — kitett fájlok, backup, `.git`, `.env`, stb.
- `takeovers/` — subdomain takeover detection
- `technologies/` — tech stack fingerprinting (nem sérülékenység, csak info)
- `vulnerabilities/` — általános sérülékenység templates

**Nem engedélyezett kategóriák MVP-ben:**
- `fuzzing/` — túl zajos, false positive high
- `dns/` — van saját DNS check
- `network/` — port scan külön saját
- `headless/` — túl erőforrás-igényes

### 20.7 Monitoring checklist

- Sentry: minden `err` + custom tags (request_id, user_id, org_id)
- Axiom: structured pino logs, 7 napos retenció
- Uptime monitor: BetterStack vagy Railway healthcheck
- Alertek:
  - Scan queue size > 50
  - Failed job rate > 10%
  - AI cost/day > $5
  - p95 API latency > 1s

### 20.8 Pre-launch jogi checklist

- [ ] ToS jogász által review-zott
- [ ] Adatvédelmi tájékoztató jogász által review-zott
- [ ] Cookie consent banner (nem kritikus az MVP-hez, de GDPR szerint kell)
- [ ] NAIH nyilvántartás (adatkezelő regisztráció)
- [ ] Adatfeldolgozói szerződés Supabase + Stripe + Resend + Anthropic-kal
- [ ] DPIA (Data Protection Impact Assessment) — scan adatok érzékenysége miatt ajánlott
- [ ] Cyber insurance (nem kötelező, erősen ajánlott)

---

**Dokumentum vége.**




