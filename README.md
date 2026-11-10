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
| LGI Administrator | Manages assigned LGA operations, including service years, batches, streams, corps-member records, CDS groups, coordinator accounts, assignments, exemptions and reports. LGI administrators also maintain the shared course catalogue; catalogue changes apply across all LGAs. |
| CDS Coordinator | Manages assigned CDS groups and designates CDS Presidents only from corps members allocated to those groups. |
| CDS President | Records and views attendance for the specifically assigned CDS group. |
| Corps Member | Activates an account, maintains profile information, views allocation and attendance, and submits eligible requests. |

Role assignments must be scoped. In particular, a CDS President assignment is tied to a CDS group; it is not a global permission. LGI administrators manage LGA operational records only within their assigned LGA(s). Their shared course-catalogue management permission is available from the LGI module and changes the common reference list used by every LGA.

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

## Account recovery

Password recovery is available to authorised roles, including LGI administrators, through a self-service reset flow:

1. The user submits the email address registered to their account.
2. The system responds with a generic message regardless of whether the address exists, and creates a reset token only for an eligible account with a verified recovery email.
3. A single-use, short-lived reset link is delivered to that verified email address.
4. The user sets a new password. The API validates and consumes the token transactionally and stores the new password using Argon2id.
5. All active sessions for that account are revoked so the user must authenticate again.

Reset tokens are stored as hashes, are never logged or returned by production API responses, and are rate-limited. A password reset must never reactivate a disabled or suspended account. If an LGI loses access to the registered recovery address, recovery requires an authorised system owner to follow a separate identity-verified and audited process; a CDS Coordinator cannot reset an LGI account.

The database already includes the `password_reset` token purpose and `auth_tokens` table. The reset endpoints, email delivery integration, UI and tests remain to be implemented.

## Security and integrity requirements

- Server-side role and resource-scope checks on every protected operation.
- Argon2id password hashing and opaque, hashed session tokens.
- Single-use, expiring activation tokens.
- Coordinator disablement revokes existing sessions.
- Database constraints and transactions protect unique assignments and group capacity.
- Audit records retain administrative changes and historical attendance.
- Biometric identity verification, if introduced, requires privacy review, secure processing, consent/lawful-basis analysis, retention limits, liveness/PAD and empirical threshold calibration. Use synthetic data during development.

## Development status

The development branch contains the frontend login and LGI dashboard, responsive layouts and mobile navigation updates. The authentication API, database schema and synthetic seed have been implemented and tested in the local development environment. The latest responsive changes still require local Svelte checks, production build and browser validation across the documented viewport widths.

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
| Responsive landing and login layouts | Implemented on the development branch; local validation pending |
| Responsive LGI mobile navigation drawer and sticky header | Implemented on the development branch; local validation pending |
| CDS group domain model and API design | Documented |
| Shared course catalogue categories and aliases schema | Implemented; course-alias migration generated, committed and applied locally |
| LGI shared course catalogue management and CSV import API | Implemented; GitHub Actions API typecheck passed; database/import integration checks pending |
| LGI course catalogue screen | Implemented; GitHub Actions Svelte check and production build passed |
| LGI searchable read-only course picker | Implemented; GitHub Actions Svelte check and production build passed |
| Expanded development course starter records | Added to the seed; local seed validation pending |
| CDS groups, course mappings and membership-history Drizzle schemas | Added on the development branch |
| CDS group migration | Generated, committed and applied successfully to the local PostgreSQL database |
| Group-scoped role assignments | Added to the database schema and authenticated role context |
| LGI CDS Group Management API | Implemented on the development branch; local typecheck and integration tests pending |
| LGI CDS Groups interface | Implemented on the development branch; local Svelte check and browser tests pending |

| LGI course catalogue API | Implemented on the development branch; local typecheck and access tests pending |
| LGI course catalogue interface | Implemented on the development branch; local Svelte check and browser tests pending |
| CSV catalogue import and template | Implemented on the development branch; local import tests pending |
| LGI shared course catalogue and searchable CDS-group picker | Implemented on the development branch; local integration tests pending |
| CDS Coordinator account and group assignment management | Implemented on the development branch; GitHub Actions API typecheck, Svelte checks and frontend build passed; email delivery and runtime integration tests remain pending |
| CDS group handover records, transfer and successor acknowledgement | Implemented on the development branch; migration, API and UI added; CI and runtime database testing pending |

## CDS Coordinator management

LGI administrators manage Coordinator invitations, group assignments, account disable/reactivate and session revocation from `/lgi/coordinators`. Coordinators can be assigned to multiple groups within the LGI's assigned LGA scope; each active group has one active coordinator. Disabling an account releases its group assignments while preserving inactive history. For a unit-level resignation or replacement, the LGI can transfer an individual CDS group, record pending activities, upcoming events and outstanding tasks, and require the successor to acknowledge the handover from `/coordinator/handovers`. Group membership and historical records remain with the CDS group. The full group-operations workspace is still future work. See [Coordinator Management documentation](docs/coordinator-management.md) for lifecycle rules, handover details and remaining email-delivery work.

## Shared course catalogue

The shared academic course catalogue is managed from the existing LGI administration module at `/lgi/course-catalogue`. LGI administrators can add, edit, deactivate/reactivate and bulk-import courses. These changes apply to the shared catalogue used by all LGAs. It supports discipline categories, canonical course names, aliases and CSV import. The development starter catalogue is representative, not exhaustive or an official national list. See [Course Catalogue documentation](docs/course-catalogue.md) for the API, CSV format, bootstrap and security rules.

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

1. Pull the latest development branch and run API typecheck, frontend check and production build.
2. Generate, review and apply the course-alias migration, then run the development seed.
3. Test LGI course catalogue management, CSV import and shared catalogue search from CDS Group Management.
4. Polish CDS Group Management and the searchable course picker.
5. Integrate email delivery and complete runtime tests for CDS Coordinator invitations, group assignment, handover transfer/acceptance, disable/reactivate and session revocation.
6. Build corps-member administration and NYSC cohort/reference-data management.
7. Add Coordinator-scoped President designation, meeting attendance and reports.
