# CDS Group Management: Data Model and API Design

## Purpose

Define the data model and service boundaries for LGI-managed CDS groups, coordinator assignments, corps-member allocation and group-scoped CDS President permissions. This is the first backend feature after the authentication and responsive-dashboard milestones.

## Domain entities

### 1. CDS groups

A CDS group belongs to exactly one LGA.

Proposed fields:
- `id`: UUID primary key.
- `lga_id`: required FK to `lgas`.
- `code`: short stable code, unique within the LGA.
- `name`: display name, unique within the LGA.
- `description`: optional purpose/details.
- `max_capacity`: positive integer.
- `is_active`: prevents new allocations when false; does not delete historical records.
- `created_at`, `updated_at`.

The service must reject a capacity reduction below the current active membership count.

### 2. Group-course eligibility

Use a join table `cds_group_courses` to map one or more existing `courses` to each CDS group. Add a unique constraint on `(cds_group_id, course_id)`. Initial allocation eligibility uses explicit course mappings; a later enhancement may support discipline-category rules where operational policy requires them.

### 3. Group membership / allocation history

Use `cds_group_memberships` to record which corps member belongs to which CDS group.

Proposed fields:
- `id`, `cds_group_id`, `corps_member_id`.
- `status`: active, ended or cancelled.
- `source`: automatic or manual.
- `assigned_by_user_id`: nullable for system allocation, otherwise the LGI user.
- `assigned_at`, `ended_at`.

Integrity requirements:
- A corps member may have at most one active CDS group membership at a time.
- Historical memberships are retained rather than overwritten or deleted.
- Capacity checks and membership insertion must happen in one database transaction while locking the target group row, so simultaneous allocations cannot exceed capacity.
- A group marked inactive cannot receive new allocations.

### 4. Group-scoped user roles

Extend `user_role_assignments` with nullable `cds_group_id` referencing `cds_groups`.

Scope rules:
- `LGI_ADMIN` remains LGA-scoped via `lga_id`.
- `CDS_COORDINATOR` assignments are group-scoped; a Coordinator assigned to multiple groups has one active assignment per group.
- `CDS_PRESIDENT` is group-scoped and is granted to the existing corps member's user account, not to a duplicate identity.
- `CORPS_MEMBER` remains the member's ordinary identity role and does not need a CDS group scope.
- Group-scoped roles must be checked server-side against the requested group on every operation.

Before granting `CDS_PRESIDENT`, the API must verify that the selected corps member is actively allocated to the target group and has an existing linked user account. If the person has not activated yet, create/link the account and use the existing single-use activation-token workflow.

The service must also enforce at most one active President per CDS group. Removing a President role must not disable the corps-member account or erase attendance.

### 5. Coordinator lifecycle

LGI operations:
- Create/invite a Coordinator account.
- Assign one or more CDS groups in the LGI's LGA.
- Issue a single-use, expiring activation token through the existing auth-token service pattern.
- Disable/reactivate the account.
- Revoke all active sessions on disable.
- Reassign their groups while retaining assignment history.

A disabled Coordinator must fail authentication even if a previously issued session cookie exists. Account state changes must not delete the user's historical actions.

## API boundary (planned)

All endpoints are authenticated and enforce LGA/group scope in the API; hiding a button in the browser is not authorization.

LGI-only:
- `GET /lgi/cds-groups` — list groups in the authenticated LGI's LGA, including active member count and coordinator assignment.
- `POST /lgi/cds-groups` — create a group in the authenticated LGI's LGA.
- `GET /lgi/cds-groups/:groupId` — group details and mapped courses.
- `PATCH /lgi/cds-groups/:groupId` — update name, code, description, capacity, active state and course mappings.
- `POST /lgi/cds-groups/:groupId/coordinator` — assign an existing invited/active Coordinator to a group.

Coordinator account administration (LGI-only):
- `GET /lgi/coordinators`
- `POST /lgi/coordinators`
- `PATCH /lgi/coordinators/:userId/status`
- `PUT /lgi/coordinators/:userId/groups`

Coordinator-only:
- `GET /coordinator/groups` — only assigned groups.
- `GET /coordinator/groups/:groupId/members` — only if the Coordinator has an active assignment to that group.
- `POST /coordinator/groups/:groupId/president` — designate a President only from active members of an assigned group.

The first implementation should deliver CDS-group CRUD and course mapping before Coordinator invitations and President designation.

## LGI password recovery

The current identity schema already supports `password_reset` tokens. Implement the workflow as follows:

- Add `POST /auth/password/forgot` with an email-only request body. Always return the same generic response to avoid account enumeration.
- Only issue a token for an eligible active account with a verified recovery email.
- Generate a cryptographically random token, persist only its SHA-256 hash in `auth_tokens`, set purpose `password_reset`, and use a short expiry (30 minutes is the initial policy).
- Deliver the raw token only through the verified recovery email provider; never log it, expose it from production endpoints or store it in plaintext.
- Add `POST /auth/password/reset` that validates the token, purpose, expiry and unused state, then consumes the token and updates the Argon2id password hash in one transaction.
- Revoke all of the user's active sessions in that same transaction after a successful reset.
- Rate-limit requests and responses; require HTTPS in production.
- A reset must not change `disabled` or `suspended` account status.
- If an LGI loses access to their registered recovery email, require an authorised platform-level administrator to complete a separately audited identity-verification process. A Coordinator or Corps Member cannot reset an LGI account.

The current `auth_tokens` table and `auth_token_purpose` enum already cover token storage and `password_reset`; no new database migration should be required for this feature. The API routes, email integration, reset UI and tests are still pending.

## Validation and security

- Validate all request bodies with Zod.
- Derive LGA scope from the authenticated user's active `LGI_ADMIN` assignment. Do not accept an arbitrary LGA ID from the browser as authority.
- Reject cross-LGA group IDs and member IDs.
- Use transactions for capacity checks, role changes and account disablement/session revocation.
- Apply database constraints for uniqueness and valid foreign keys; use partial unique indexes for active-only invariants where supported.
- Keep secrets out of logs and API responses.
- Add audit-event records for group changes, allocations, coordinator assignments, President designation and account status changes before production use.

## Delivery sequence

1. Add Drizzle schemas and migration for CDS groups, course mappings, memberships and scoped role assignments.
2. Add a deterministic synthetic CDS group and mappings to the development seed.
3. Implement LGI CDS-group CRUD endpoints and tests.
4. Implement the LGI CDS Groups interface (responsive list, create/edit form, capacity and mapped courses).
5. Implement coordinator invitation, assignment, disable/reactivate and session revocation.
6. Implement Coordinator group access and scoped President designation.
7. Add integration tests for LGA isolation, role-scope isolation, capacity races, duplicate active membership and President eligibility.
