# NYSC CDS Management Platform

A role-based platform for managing NYSC Community Development Service (CDS) operations, corps-member allocation, meetings, attendance and monthly readiness.

## Architecture overview

The platform is a **Bun workspaces monorepo** with a SvelteKit web application, a Hono API and a shared Drizzle database package.

| Layer | Technology | Responsibility |
|---|---|---|
| Web application | SvelteKit 3, Svelte 5, Vite | Role-based user interfaces and browser navigation |
| API runtime | Hono on Bun | HTTP routes, authentication, validation, authorization and business rules |
| Data access | Drizzle ORM, `postgres` driver | Typed queries and PostgreSQL access, shared through `@nysc/database` |
| Database | PostgreSQL 17 | Accounts, role assignments, CDS groups, meetings, attendance, documents, announcements and operational records |
| Local infrastructure | Docker Compose | Runs PostgreSQL and Redis with persistent named volumes |
| Workspace tooling | Bun | Installs dependencies and runs the web and API development processes |

### System architecture

The diagram below shows the **current local development topology**. It distinguishes the Dockerized database from the web and API processes, which currently run through Bun on the developer's machine.

```mermaid
flowchart TB
  Browser["User browser"]

  subgraph Local["Developer machine — Bun processes"]
    Web["SvelteKit 3 / Svelte 5<br/>Vite web application"]
    API["Hono API<br/>Bun runtime — port 3001"]
    Modules["API modules<br/>Auth · LGI · Coordinator · President<br/>Corps Member · CLO · Attendance<br/>Documents · Announcements · Reports"]
    Data["@nysc/database<br/>Drizzle ORM + postgres driver"]
    Web -->|"Vite proxies /api/*<br/>to localhost:3001"| API
    API --> Modules
    Modules --> Data
  end

  subgraph Docker["Docker Engine — Docker Compose"]
    PG[("PostgreSQL 17 Alpine<br/>nysc-postgres")]
    Volume[("Persistent volume<br/>nysc-postgres-data")]
    Redis[("Redis 7.4 Alpine<br/>nysc-redis")]
    RedisVolume[("Persistent volume<br/>nysc-redis-data")]
    PG <--> Volume
    Redis <--> RedisVolume
  end

  Browser -->|"Web UI"| Web
  Data -->|"DATABASE_URL<br/>localhost:5432"| PG
  API -->|"REDIS_URL<br/>localhost:6379"| Redis
```

### Runtime and container topology

The repository supports two run modes:

- **Local development:** Docker Compose runs PostgreSQL and Redis; the SvelteKit frontend and Hono API run directly through Bun for hot reload.
- **Containerised application profile:** `docker compose --profile app up --build -d` adds the API, web server and Nginx reverse proxy. Nginx is published on `APP_PORT` (8080 by default).

The containerised request flow is:

```mermaid
flowchart TB
  Browser["Browser"]
  Nginx["Nginx reverse proxy"]
  Web["SvelteKit 3 / Svelte 5<br/>Bun server"]
  API["Hono API<br/>Bun runtime"]
  PG[("PostgreSQL 17")]
  Redis[("Redis 7.4")]
  Photos[("Persistent photo volume")]
  Docs[("Persistent document volume")]
  Browser -->|"Web routes"| Nginx
  Browser -->|"/api/*"| Nginx
  Nginx -->|"/"| Web
  Nginx -->|"/api/*; strips /api prefix"| API
  API --> PG
  API --> Redis
  API --> Photos
  API --> Docs
```

- API and web containers are private to the Compose network; Nginx is the application entry point. The API listens on `3001` and SvelteKit on `3000`.
- Nginx forwards `/api/*` requests to Hono and removes the `/api` prefix, matching the existing Vite development proxy.
- PostgreSQL and Redis retain loopback-only host ports (`127.0.0.1:5432` and `127.0.0.1:6379`) for local database tools and development processes.
- PostgreSQL, Redis, Corps Member photos and submitted documents use named Docker volumes. Photo/document volumes are local Docker storage, not a substitute for encrypted object storage in a multi-host production deployment.
- The API trusts forwarded client-address headers only behind Nginx, which overwrites `X-Forwarded-For` rather than preserving a client-supplied value.
- The Compose application profile is HTTP-only by default. Keep HSTS and secure cookies disabled for local HTTP; enable them when a trusted HTTPS/TLS endpoint is configured.
- This is a containerised deployment baseline, not a claim that production operations are complete. Public deployment still requires TLS, managed secrets, backup/restore procedures, monitoring and an appropriate persistent storage strategy.

### Repository layout

| Path | Contents |
|---|---|
| `apps/web` | SvelteKit application, role-based pages, shared UI components and web Dockerfile |
| `apps/api` | Hono API entry point, route modules, middleware, application services and API Dockerfile |
| `packages/database` | Drizzle client, PostgreSQL schema, migrations and development seed |
| `infrastructure/nginx/nginx.conf` | Reverse-proxy routing for the containerised web and API services |
| `infrastructure/monitoring` | Prometheus scrape configuration, exporters, Grafana provisioning and infrastructure dashboard |
| `docker-compose.yml` | PostgreSQL, Redis and optional `app` and `monitoring` profiles |
| `.dockerignore` | Excludes local secrets, dependencies, build artefacts and private local uploads |
| `.env.example` | Environment-variable template for development and the Compose application profile |

The API is a modular monolith. The browser presents the interface, but the API remains responsible for authentication, authorization, data validation and business rules. Protected operations must enforce role and resource scope on the server; hiding a button in the browser is not an authorization check.

## Role model

| Role | Scope and responsibilities |
|---|---|
| LGI Administrator | Manages assigned LGA operations: Corps Member records, service years, batches, streams, CDS groups, shared course catalogue, Coordinator accounts, CLO assignments, document requirements, reports and monthly clearance. |
| CDS Coordinator | Manages only assigned CDS groups, member rosters, President designations, WhatsApp group settings, CDS meetings, attendance review and Coordinator announcements. |
| CDS President | Works only with group(s) attached to an active President assignment; coordinates the group, records attendance and submits eligible announcements for review. |
| Corps Member | Uses one personal account to manage their member portal, view NYSC/CDS allocation and contacts, submit required documents, join the assigned WhatsApp group and view approved attendance. |
| Corps Liaison Officer (CLO) | Views document submissions across all LGAs and makes human verification/resubmission decisions on items awaiting manual review; CLO account management remains assigned to selected LGI administrators. |

Role assignments must be scoped. In particular, a CDS President assignment is tied to a CDS group; it is not a global permission. LGI administrators manage LGA operational records only within their assigned LGA(s). The shared academic course catalogue is centrally managed from the LGI module and is used across LGAs.

A person who is both a Corps Member and CDS President uses **one account** with multiple role assignments. The President role does not create a duplicate Corps Member record. Removing the President role must not disable the underlying Corps Member account.

## Account administration workflow

1. An LGI administrator creates/invites a CDS Coordinator and assigns one or more CDS groups within the LGI's scope.
2. The Coordinator activates their account using the invitation flow.
3. The Coordinator selects an existing active Corps Member from one of their assigned groups and designates that member as CDS President.
4. If the selected member has not activated their portal account, the President designation can remain pending until account activation.
5. President replacements are confirmed and recorded in designation history, including the reason supplied by the Coordinator.
6. LGI administrators manage Coordinator account status, group transfers and handovers. A successor can review and acknowledge transferred group responsibilities.
7. LGI administrators create CLO access and configure the LGA coverage used for document handling.

A Corps Member must not receive a duplicate person/account record when designated President. Disabling a Coordinator must preserve historical attendance, meetings, handovers and audit records.

## Responsive design requirements

Responsive behaviour is a project-wide acceptance requirement, not a post-launch enhancement.

| Target | Width | Expected behaviour |
|---|---:|---|
| Small mobile | 360–390 px | Single-column content, compact header, drawer navigation, no page-level horizontal overflow |
| Large mobile | 391–430 px | Single-column content with appropriately sized cards and controls |
| Tablet | 768–1024 px | Adaptive navigation and two-column content where it fits |
| Laptop | 1280–1440 px | Full dashboard navigation and multi-column summaries |
| Wide desktop | 1600 px and above | Expanded layout with readable maximum content width |

Responsive acceptance checks:
- Login forms fit narrow screens; inputs and primary actions are touch-friendly.
- LGI navigation collapses into an accessible mobile drawer.
- Dashboard cards reflow without clipping.
- Data tables use a deliberate mobile treatment (horizontal scroll within the table region or stacked record cards), never page-wide overflow.
- Dialogs, forms, validation messages and action menus remain usable on touch screens.
- Keyboard navigation, visible focus, semantic labels and sufficient contrast are maintained.
- Test at 360, 375, 390, 430, 768, 1024, 1280 and 1440 CSS pixels.

## Implemented workspace capabilities

The following describes functional areas present in the current development branch. Production readiness still depends on provider configuration, deployment, security review and end-to-end testing.

## User guides and operations documentation

- [User Guide Index](docs/user-guide/README.md) — sign-in and workflows for LGI Administrators, CDS Coordinators, CDS Presidents, Corps Members and CLO officers.
- [Document Verification Workflow](docs/document-verification.md) — Manual, AI Auto and AI-assisted review behaviour.
- [Monitoring guide](docs/monitoring/README.md) — optional Prometheus/Grafana setup, target-health checks and dashboard screenshots.
- [Screenshot asset manifest](docs/assets/screenshots/README.md) — 22 JPEG screenshots tracked in the repository under `docs/assets/screenshots/`.


| Workspace / area | Implemented functionality |
|---|---|
| LGI administration | Manage service years, batches, streams, Corps Member records, CDS groups, membership, Coordinator accounts and group assignments. |
| Shared course catalogue | Manage course categories, canonical course names and aliases; import course data from CSV; use the searchable catalogue when mapping courses to CDS groups. |
| Coordinator management | Invite and manage Coordinators, transfer group responsibility, maintain handover records and review successor acknowledgements. |
| CLO management | Create/manage CLO access and configured LGI management assignments; review items awaiting human decision across the platform. Document requirements are created, edited and published by LGI administrators. |
| Coordinator workspace | View assigned CDS groups and members; designate or replace a President from existing group members; manage the group's WhatsApp invite link and optional WhatsApp assistant. |
| CDS President workspace | View assigned group(s) and member roster; open meeting registers, mark members present/absent/late/excused and submit the completed register. |
| Attendance management | Coordinators schedule CDS meetings, inspect submitted registers, approve attendance or return it for correction with review notes. Returned registers can be corrected and resubmitted. LGI attendance reporting is read-only. |
| Corps Member portal | View NYSC profile details, group assignment, contacts, document checklist, WhatsApp access and approved attendance history. A dual-role member can move to the President workspace without creating a second account. |
| Document handling | Corps Members submit required documents; authorized LGI and CLO reviewers can verify submissions or request resubmission. Manual review is the default document-verification mode. |
| Announcements and notifications | Role-based announcement workflows and a shared notification centre with unread counts and mark-all-read behaviour. |
| Reports and monthly clearance | LGI attendance analytics/reporting and monthly-clearance workflows, with scoped Coordinator visibility where applicable. |

See [Document Verification Workflow](docs/document-verification.md) for Manual, AI Auto and AI-assisted verification behaviour, LGI review and human override rules.

### Attendance lifecycle

1. The Coordinator schedules a meeting for an assigned CDS group.
2. The President opens the register and records each member as present, absent, late or excused.
3. The President submits the completed register. A submitted register is locked while awaiting review.
4. The Coordinator approves the register or returns it with a correction note.
5. A returned register can be updated by the President and submitted again. An approved register is locked and its approved attendance is visible in the Corps Member portal.

### Documents and announcements

- LGI administrators configure and publish the document requirements used by Corps Members.
- Corps Members upload the requested documents through their portal.
- CLO reviewers can process document submissions across all LGAs. LGI administrators remain responsible for creating and publishing the document requirements.
- LGI administrators and Coordinators publish announcements to selected groups through their respective workflows. President announcements are subject to Coordinator review before publication.
- The notification bell provides a shared place for authenticated users to see relevant unread notifications.

### WhatsApp group access

A Coordinator manages the invite link for each assigned CDS group and can optionally designate one group member as its WhatsApp assistant. Eligible Corps Members assigned to that group see the Join WhatsApp Group action in their portal. Coordinators can change or remove the link and assistant for their own assigned groups.

## API security, throttling and observability

The API applies shared security and observability middleware:

- **Request correlation:** every request receives a server-generated request ID. The API returns it in the `X-Request-Id` response header and includes it in logs and unexpected-error responses.
- **Security headers:** Hono's secure-headers middleware removes the framework-identifying header and applies browser security headers. Strict-Transport-Security is enabled only in production, where HTTPS is expected.
- **Central error handling:** uncaught errors return a generic response and request ID. Internal exception details are not sent to the client.
- **Structured request logs:** one JSON record is emitted per completed request with timestamp, request ID, method, path, status and duration. Query strings, request bodies, cookies, authorization headers and client IP addresses are deliberately excluded.

### Distributed API throttling

A shared Redis 7.4 service provides fixed-window request counters across API instances. Counters are incremented and assigned an expiry atomically using a Redis Lua script. The API derives client keys with HMAC-SHA256 using the rate-limit pepper; raw client IP addresses are not written to Redis keys.

| Scope | Threshold | Window | Applied to |
|---|---:|---:|---|
| General API | 1,200 requests | 5 minutes | All routes except health probes |
| Authentication | 600 requests | 15 minutes | `/auth/*` |
| Upload operations | 120 requests | 10 minutes | Write requests for document, upload, photo and import routes |
| Attendance writes | 600 requests | 5 minutes | Write requests to attendance routes |

The general limit is applied in addition to the route-specific limit. Health probes (`/health`, `/health/db` and `/health/redis`) bypass request throttling so monitoring can still diagnose a Redis incident. A request that exceeds a limit receives HTTP 429, a `Retry-After` header and rate-limit response headers. Windows are fixed windows, not sliding windows.

Redis connection failures are logged as a degraded rate-limiting state and the general middleware fails open so a Redis outage does not make every API route unavailable. The existing PostgreSQL-backed failed-login and identity-verification limits remain independent and continue to protect those sensitive flows. Production monitoring should alert on `api.rate_limit.redis_unavailable` and `api.rate_limit.redis_recovered` log events.

### Redis reference-data caching

Redis also provides read-through JSON caching for shared reference data. Each dataset has an explicit TTL and a namespace version. Successful LGI mutations increment the relevant namespace version so old query variants are no longer served; cache failures fall back to PostgreSQL and are logged without failing the request.

| Reference data | Cache lifetime | Invalidation |
|---|---:|---|
| Course catalogue search/list results, including aliases | 30 minutes | Course create, edit and CSV import |
| Active course options | 30 minutes | Course create, edit and CSV import |
| Active LGA/state options | 1 hour | Time-based expiry; LGI access scope is filtered after cache read |
| Active institution options | 1 hour | Time-based expiry |
| Service-year, batch and stream form options | 30 minutes | Service-year, batch or stream create/edit |
| CDS group form reference data (assigned LGAs and active courses) | 5 minutes | Course create, edit and CSV import; each LGA scope has a separate cache key |

The cache contains only shared reference options. Authentication and LGI role checks still run for each request, and LGA-scoped results are filtered using the authenticated account's current assignments after the shared LGA directory is read.

Operational or personal data is deliberately excluded: Corps Member records and profiles, documents, attendance, notifications, CDS group rosters, live group membership/capacity counts and the /lgi/batches-streams structure (which includes live member counts) are always read from PostgreSQL. Cache invalidation uses Redis namespace version counters rather than blocking key scans. If Redis is unavailable, reads bypass the cache and use PostgreSQL; failed invalidations are logged and the bounded TTL limits stale data.

### Authentication throttling

Failed login attempts are also tracked in PostgreSQL using HMAC-derived bucket keys. Raw login identifiers and source IP addresses are not stored in the rate-limit table.

| Scope | Threshold | Window | Block |
|---|---:|---:|---:|
| Source IP | 30 failed login attempts | 15 minutes | 15 minutes |
| Login identifier + source IP | 5 failed login attempts | 15 minutes | 15 minutes |

A successful login clears that identifier/IP failure bucket. The IP bucket remains so that a successful login to one account cannot erase failed attempts against other accounts from the same address. Rate-limited responses use HTTP 429 and include a `Retry-After` header.

The existing Corps Member identity-verification throttling and OTP send/verification limits also remain in place.

### Redis configuration

The local Docker Compose configuration runs Redis 7.4 Alpine with a password and persistent named volume. Redis is published only on `127.0.0.1:6379`; the API running locally connects through the `REDIS_URL` in the root `.env`.

Generate a unique Redis password and HMAC pepper:

```bash
openssl rand -hex 32
```

Set the generated values in your untracked root `.env`:

```env
REDIS_PASSWORD=<your-generated-redis-password>
REDIS_URL=redis://:<your-generated-redis-password>@127.0.0.1:6379/0
API_RATE_LIMIT_PEPPER=<your-generated-hmac-secret>
```

Use the same Redis password in `REDIS_PASSWORD` and the URL. Do not commit `.env` or real credentials. In production, use a managed/private Redis endpoint, TLS where supported, and a dedicated secret value; do not expose Redis directly to the public internet.

Start and inspect the local services:

```bash
docker compose up -d postgres redis
docker compose ps
```

The API health endpoint `GET /health/redis` reports whether Redis is reachable. It returns HTTP 503 when Redis is unavailable. The liveness endpoint `GET /health` remains independent of Redis.

### Logging privacy

Never log passwords, OTP values, session tokens, cookies, authorization headers, dates of birth, State Codes, call-up numbers or uploaded document contents. Production logs should be routed to a protected log service with access controls and retention limits.

Redis caching is not included in this milestone; it will be introduced separately with explicit per-data caching and invalidation policies.

## Account recovery status

The database schema includes the `password_reset` token purpose and `auth_tokens` table, but the complete self-service password-recovery flow is **not yet available as a production-ready feature**. The reset UI, delivery integration, single-use token handling and end-to-end tests must be completed and verified before it is presented as an available production feature.

When implemented, recovery must use generic responses, short-lived single-use hashed tokens, rate limits, transactional token consumption and session revocation. A password reset must never reactivate a disabled or suspended account. Recovery of an LGI account whose registered email is inaccessible requires an authorised, identity-verified and audited administrative process.

## Security and integrity requirements

- Server-side role and resource-scope checks on every protected operation.
- Argon2id password hashing and opaque, hashed session tokens.
- Single-use, expiring activation tokens.
- Coordinator disablement revokes existing sessions.
- Database constraints and transactions protect unique assignments and group capacity.
- Audit records retain administrative changes and historical attendance.
- Biometric identity verification, if introduced, requires privacy review, secure processing, consent/lawful-basis analysis, retention limits, liveness/PAD and empirical threshold calibration. Use synthetic data during development.

## Development status and production readiness

### Implemented in the development branch

- Role-scoped authentication, account activation and PostgreSQL-backed sessions.
- LGI administration for cohorts, Corps Member records, CDS groups, course catalogue, Coordinator and CLO management.
- Coordinator group operations, President designation/replacement, WhatsApp group management, meetings and attendance review.
- CDS President attendance recording and announcement workflows.
- Corps Member portal, NYSC cohort/profile details, document submission and approved attendance history.
- CLO document review, announcement/notification workflows, LGI reports and monthly-clearance screens.
- Responsive layouts and mobile navigation across the role workspaces.

These features are being developed and validated incrementally. A feature being present in the development branch does not by itself mean its provider integrations, accessibility review, browser coverage or production operations are complete.

### Remaining deployment and verification work

- Configure and verify real email/SMS delivery providers for onboarding and other flows that require external delivery. The example configuration defaults `OTP_DELIVERY_MODE=console` for local development.
- Complete and validate Coordinator invitation email delivery where required.
- Configure persistent, encrypted and access-restricted storage for uploaded profile photos and documents. The example paths under `.data/` are local-development defaults.
- Keep document verification in manual mode unless AI mode, its API key, privacy controls and fallback behaviour have been deliberately configured and tested.
- Complete automated integration tests and browser acceptance testing across the responsive viewport widths listed above.
- Complete the self-service password-recovery flow before describing it as available.
- Define and test the production hosting topology, secrets management, database backups, monitoring and recovery procedures. The current Compose file is a local PostgreSQL setup, not a full production deployment.

## CDS Coordinator management

LGI administrators manage Coordinator invitations, group assignments, account disable/reactivate and session revocation from `/lgi/coordinators`. A Coordinator can be assigned to multiple groups within the LGI's assigned LGA scope; active group responsibility is explicitly assigned.

For a unit-level resignation or replacement, the LGI can create or assign a successor, transfer a CDS group, record pending activities, upcoming events and outstanding tasks, and require the successor to acknowledge the handover from `/coordinator/handovers`. Group membership and historical records remain with the CDS group.

Within assigned groups, Coordinators can view the member roster, designate or replace a CDS President from existing members, manage WhatsApp group settings, schedule meetings, review attendance registers, publish announcements and work with group-scoped monthly-clearance information. President designation history is retained. See [Coordinator Management documentation](docs/coordinator-management.md) for lifecycle rules, handover details and remaining email-delivery work.

## Shared course catalogue

The shared academic course catalogue is managed from the existing LGI administration module at `/lgi/course-catalogue`. LGI administrators can add, edit, deactivate/reactivate and bulk-import courses. These changes apply to the shared catalogue used by all LGAs. It supports discipline categories, canonical course names, aliases and CSV import. The development starter catalogue is representative, not exhaustive or an official national list. See [Course Catalogue documentation](docs/course-catalogue.md) for the API, CSV format, bootstrap and security rules.

## CDS group allocation algorithm

The platform uses a **rule-based, constraint-aware greedy allocation process with least-utilised-first load balancing**. These are three complementary algorithmic techniques working together in one automatic allocation flow, not three separate allocation services.

### 1. Rule-based eligibility filtering

Before an automatic assignment is considered, the system checks the Corps Member and the available CDS groups against explicit business rules:

- The Corps Member record must exist, must not have a rejected profile and must have an academic course recorded.
- The LGA must have active document requirements, including at least one active mandatory requirement. The latest submission for every active mandatory requirement must have a `verified` status.
- The Corps Member must not already have an active CDS group membership.
- A candidate CDS group must be active, belong to the Corps Member's LGA and have an exact course-ID mapping for the Corps Member's recorded course.
- A group previously cancelled by that Corps Member is excluded from their automatic candidate list.
- The candidate group must have at least one available seat.

The LGI configures course eligibility by mapping catalogue courses to each CDS group. Matching uses the stored course IDs; it is not AI prediction, machine learning or fuzzy course-name matching.

### 2. Greedy group selection

After filtering, the system selects the best currently eligible group in one pass through the ordered candidates. It does not calculate a global assignment plan across all Corps Members. New members are allocated one at a time as their verification process completes.

### 3. Least-utilised-first load balancing

Eligible groups are ranked by capacity utilisation:

`utilisation = active members / maximum capacity`

The group with the lowest utilisation is selected first, helping distribute new members across groups instead of filling one group before considering others. Ties are resolved deterministically by:

1. Lower active-member count.
2. Earlier group creation date.
3. Group ID in ascending order.

The member and candidate groups are locked within the database transaction during matching to reduce the risk of concurrent registrations taking the same final seat. The selected membership is recorded with an automatic assignment source.

### LGI manual placement and course-mapping override

LGI administrators can also place a Corps Member into a selected group through the manual assignment workflow. The system still enforces LGA scope, active group status, mandatory-document verification, one active membership per Corps Member and group capacity. The member's course must match the group's mapped course unless an authorised LGI explicitly uses the course-mapping override and supplies a reason of at least 10 characters. The override and reason are stored with the membership for traceability.

### Allocation outcomes

Automatic matching can return a clear outcome such as: member not found, course not recorded, document requirements not configured, documents incomplete, already assigned, no eligible group or all eligible groups full. This makes it possible for the application to explain why an automatic assignment did not take place instead of silently assigning a member to an unsuitable group.

## Local development

### Prerequisites

- Bun installed.
- Docker Engine and the Docker Compose plugin.
- Git.

### Configure environment

From the repository root:

```bash
cp .env.example .env
```

Review `.env` and set the PostgreSQL values and `DATABASE_URL`. The example file contains local placeholders; replace them before using the environment. Do not commit `.env` or real credentials.

### Start PostgreSQL and Redis with Docker Compose

```bash
docker compose up -d postgres redis
docker compose ps
```

Compose starts PostgreSQL 17 Alpine and Redis 7.4 Alpine. PostgreSQL is exposed on `127.0.0.1:5432` and Redis on `127.0.0.1:6379`; both use persistent named volumes. Set `REDIS_PASSWORD` and `REDIS_URL` in `.env` as described in [Redis configuration](#redis-configuration).

### Install, migrate and seed

```bash
bun install
bun run --filter @nysc/database db:migrate
bun run --filter @nysc/database db:seed
```

The seed is for development/testing. Do not load synthetic seed records into a production environment.

### Start the API and web application

Open separate terminals from the repository root.

Terminal 1 — Hono API on port `3001`:

```bash
bun run dev:api
```

Terminal 2 — SvelteKit/Vite frontend:

```bash
bun run dev:web
```

Vite proxies requests under `/api` to `http://localhost:3001`. The API connects to PostgreSQL using `DATABASE_URL`.

### Run the full containerised application

After configuring `.env` and applying the database migrations, start the application profile:

```bash
docker compose --profile app up --build -d
docker compose --profile app ps
```

Open `http://localhost:8080` (or the port configured by `APP_PORT`). Inspect logs with:

```bash
docker compose --profile app logs -f api web nginx
```

Stop containers without deleting persistent data:

```bash
docker compose --profile app down
```

The existing local development commands remain available. Compose overrides API database and Redis URLs with internal Docker hostnames; host-side URLs remain available to Drizzle migrations and Bun processes running directly on your machine. Use URL-safe hexadecimal values for DB and Redis passwords (for example, `openssl rand -hex 32`) because Compose builds internal connection URLs from those values.

The Compose application profile is HTTP-only. Keep `COOKIE_SECURE=false` and `HSTS_ENABLED=false` until a trusted HTTPS/TLS endpoint is configured. The API trusts forwarding headers only inside this profile; local Bun development continues to use direct socket addresses.

Database migrations and seeding are run from the repository using the commands above. The API runtime image intentionally excludes development-only migration tooling.

### Optional Prometheus and Grafana monitoring

The optional `monitoring` profile starts Prometheus, Grafana, PostgreSQL Exporter, Node Exporter, cAdvisor and Blackbox Exporter. It does not change the default local development or `app` profile startup.

Set `GRAFANA_ADMIN_PASSWORD` in `.env` to a unique value. For the API health probes, run the API directly on the host in a separate terminal:

```bash
bun run dev:api
```

Then start the database and monitoring services:

```bash
docker compose --profile monitoring up -d
```

Open Grafana at `http://localhost:3000` and Prometheus at `http://localhost:9090`. Check scrape status at `http://localhost:9090/targets`. The API health probes expect the host API on port `3001`; they show DOWN while that process is stopped. See the [Monitoring Guide](docs/monitoring/README.md) for details and limitations.

To stop only the monitoring services while leaving PostgreSQL and Redis running:

```bash
docker compose stop prometheus grafana postgres-exporter node-exporter cadvisor blackbox-exporter
```

### Checks

```bash
bun run --filter @nysc/web check
bun run --filter @nysc/web build
bun run --filter @nysc/api typecheck
bun run --filter @nysc/api test
```

To stop the local database container without deleting its data:

```bash
docker compose stop postgres
```

Do not use `docker compose down -v` unless you intentionally want to delete the PostgreSQL volume and its local data.

## Next implementation sequence

1. Complete browser acceptance tests for all workspaces at 360, 375, 390, 430, 768, 1024, 1280 and 1440 CSS pixels.
2. Complete integration testing for attendance submission/review, document review/resubmission, Coordinator handovers and group-scoped authorization.
3. Configure and verify provider-backed email/SMS delivery and secure persistent upload storage.
4. Complete password recovery and production-grade operational controls, including database backups, monitoring and restore tests.
5. Harden the container deployment for public traffic: TLS, managed secrets, persistent encrypted uploads, automated database backups, restore testing, monitoring and recovery procedures.
