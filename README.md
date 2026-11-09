# NYSC CDS Management Platform

A role-based platform for managing NYSC Community Development Service (CDS) operations, corps-member allocation, meetings, attendance and monthly readiness.

## Current architecture

- **Frontend:** SvelteKit 3 and Svelte 5
- **API:** Hono on Bun
- **Database:** PostgreSQL with Drizzle ORM
- **Local infrastructure:** Docker Compose
- **Repository layout:** Bun workspaces monorepo

The initial implementation is a modular monolith. The API owns authorization and business rules; the browser is not trusted to enforce permissions.

## Role model

| Role | Scope and responsibilities |
|---|---|
| LGI Administrator | Manages the LGA, service years, batches, streams, corps-member records, CDS groups, coordinator accounts, assignments, exemptions and reports. |
| CDS Coordinator | Manages assigned CDS groups and designates CDS Presidents only from corps members allocated to those groups. |
| CDS President | Records and views attendance for the specifically assigned CDS group. |
| Corps Member | Activates an account, maintains profile information, views allocation and attendance, and submits eligible requests. |

Role assignments must be scoped. In particular, a CDS President assignment is tied to a CDS group; it is not a global permission.

## Account administration workflow

1. An LGI administrator creates/invites a CDS Coordinator and assigns one or more CDS groups.
2. The Coordinator receives a single-use, time-limited activation invitation and sets their own password.
3. The Coordinator selects an existing corps member allocated to one of their assigned groups and designates that person as CDS President.
4. The President receives an invitation if their corps-member account has not yet been activated.
5. The LGI can disable/reactivate a Coordinator, revoke their active sessions, and reassign affected groups.

A corps member must not receive a duplicate person/account record when designated President. Removing the President role must not disable the underlying corps-member account. Disabling accounts preserves historical attendance, meetings and audit records.

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

## Product workflow

1. LGI configures service years, batches, streams and LGA reference data.
2. LGI preloads corps-member records and required identity/reference material.
3. Corps members activate their accounts and complete profiles.
4. The allocation engine maps member academic/course information to eligible CDS groups and balances utilisation within capacity constraints.
5. Coordinators manage only their assigned groups and designate Presidents from the existing group membership.
6. Presidents record attendance for their assigned group meetings.
7. Attendance readiness is calculated from valid distinct meetings using the configured monthly policy.

Medical exemption and reassignment decisions remain subject to authorised human review. Internal attendance readiness must not be represented as official NYSC clearance without an authorised integration.

## Security and integrity requirements

- Server-side role and resource-scope checks on every protected operation.
- Argon2id password hashing and opaque, hashed session tokens.
- Single-use, expiring activation tokens.
- Coordinator disablement revokes existing sessions.
- Database constraints and transactions protect unique assignments and group capacity.
- Audit records retain administrative changes and historical attendance.
- Biometric identity verification, if introduced, requires privacy review, secure processing, consent/lawful-basis analysis, retention limits, liveness/PAD and empirical threshold calibration. Use synthetic data during development.

## Development status

The repository currently contains the initial monorepo scaffold and baseline API connectivity screen. The local development session has also implemented login and LGI dashboard work, but those latest frontend files have not yet been pushed to this GitHub repository. Do not treat those local changes as present on `main` until they are synced.

| Component | Status |
|---|---|
| Monorepo setup | Completed locally |
| SvelteKit frontend scaffold | Completed |
| Hono backend scaffold | Completed |
| PostgreSQL + Docker | Completed locally |
| Drizzle ORM and initial schema | Completed locally |
| Synthetic seed data | Completed locally |
| Account activation, Argon2id password hashing | Completed locally |
| Login/logout and PostgreSQL session management | Implemented and tested locally |
| Authentication middleware and LGI role authorization | Implemented and typechecked locally |
| Frontend login and LGI dashboard | Implemented and committed on the development branch |
| Responsive landing and login layouts | Updated on the development branch; local validation pending |
| Responsive LGI mobile navigation drawer | Implemented on the development branch; local validation pending |
| LGI administration module | Planned |

## Local development

Use the root workspace scripts from the repository root:

```bash
bun install
bun run dev:api
bun run dev:web
```

The web development server proxies `/api` requests to the Hono API on port 3001. Keep secrets in the local ignored `.env`; commit only `.env.example`.

Run frontend diagnostics with:

```bash
bun run --filter @nysc/web check
```

Run API typechecking with:

```bash
bun run --filter @nysc/api typecheck
```

## Next implementation sequence

1. Sync the latest verified local login/dashboard/API client work into the repository.
2. Audit and fix responsive behaviour at the viewport widths listed above.
3. Build LGI CDS Group Management and coordinator account management.
4. Build corps-member administration and NYSC cohort/reference-data management.
5. Add scoped President designation, meeting attendance and reports.
