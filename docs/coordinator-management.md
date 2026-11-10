# CDS Coordinator Management

## Scope and ownership

CDS Coordinator accounts are managed by an LGI administrator from the existing LGI module at `/lgi/coordinators`.

- An LGI can manage coordinator assignments only for CDS groups in the LGA(s) assigned to that LGI account.
- One coordinator may be assigned to multiple CDS groups.
- Each active CDS group may have only one active coordinator assignment.
- Coordinators can access only the CDS groups assigned to their account. Coordinator-facing pages and APIs must enforce this scope on the server.
- The coordinator's account status controls sign-in. Disabling the account revokes its active sessions and releases its active group assignments.
- Assignment rows are retained as inactive history when removed or when an account is disabled.

## Account lifecycle

### Invite

The LGI submits a coordinator email and one or more active CDS group IDs.

- A new user is created with `pending_activation` status.
- The LGI can either assign one or more active CDS groups immediately, or create the account as a standby Coordinator with an LGA-scoped role assignment and no CDS group yet.
- A standby Coordinator can be selected for a handover to a group in that same LGA. When the transfer completes, the LGA-only standby assignment is retired and replaced by the group-scoped Coordinator assignment.
- An account-activation token is stored as a hash and expires after 24 hours.
- In the current local development environment, the one-time token is returned to the LGI screen because an email delivery provider has not yet been integrated.
- In production, creating a new or pending coordinator account is rejected until email delivery is configured. Tokens are never returned by production responses.

A coordinator activates the account using the existing activation endpoint and creates a password of at least 12 characters.

### Existing account

An active account that already has only the `CDS_COORDINATOR` role can receive additional group assignments. If an email belongs to an account with another active role, the request is rejected; do not merge unrelated identities into one coordinator account.

### Change group assignments

The LGI can replace the coordinator's group assignments within the LGI's LGA scope. Removed assignment rows are marked inactive rather than deleted. Assignments in other LGAs outside the authenticated LGI's scope are not changed.

### Transfer responsibility and handover

Use the transfer action on the specific CDS group assignment when a Coordinator resigns from a unit, moves to another unit, or needs a temporary replacement. This is different from disabling the person's entire account.

- The LGI selects the outgoing Coordinator, an active incoming Coordinator with an active Coordinator assignment in the same LGA, the reason, and handover details. The incoming Coordinator may be a standby account with no CDS group assignment; they do not need to be assigned to a different group first.
- The handover record stores notes, pending activities, upcoming events and outstanding tasks against the CDS group. The LGI records the information supplied during the handover; it is not represented as a digitally signed statement from the outgoing Coordinator.
- The transfer atomically deactivates the outgoing Coordinator's assignment for that group and activates the incoming Coordinator's assignment. Other group assignments held by the outgoing Coordinator are untouched.
- The group's membership, course mappings and other group-owned records are not deleted or recreated.
- The handover remains `pending_acceptance` until the incoming Coordinator signs in and acknowledges it.
- Only the designated incoming Coordinator can accept the record. Their optional acknowledgement note and acceptance timestamp are retained.
- A partial unique index permits only one pending handover per CDS group. LGI handover history shows pending, accepted and cancelled transfers.
- The LGI can cancel a pending handover. The incoming assignment is released and the previous Coordinator is restored if their account is still active; otherwise the group is left available for reassignment.

The current coordinator-facing workspace is limited to the handover inbox and acceptance screen at `/coordinator/handovers`; it is not yet the full group-operations workspace.

### Disable and reactivate

Disabling a coordinator:
1. Changes the account status to `disabled`.
2. Marks its active coordinator group assignments inactive, releasing those groups for reassignment.
3. Revokes every active authentication session for that account.

Reactivating a disabled coordinator changes the account back to `active` when it has a password hash, or `pending_activation` when it does not. Reactivation does not automatically reclaim old group assignments. The LGI must assign the coordinator to currently available groups again.

Suspended accounts cannot be reactivated through the coordinator management screen.

## API

The `/lgi/coordinators...` endpoints require an authenticated `LGI_ADMIN` account with at least one active LGA assignment. The `/coordinator/handovers` endpoints require an authenticated `CDS_COORDINATOR` account; the API restricts handover records to the authenticated incoming Coordinator and verifies their active group assignment before acceptance.

- `GET /lgi/coordinators` — list coordinators and their assignment history within the caller's LGA scope.
- `POST /lgi/coordinators` — create/invite a coordinator or extend an existing coordinator's group assignments.
- `PATCH /lgi/coordinators/:coordinatorId` — replace group assignments and/or disable/reactivate the account.
- `GET /lgi/coordinators/handovers` — list handover history for the caller's LGA scope.
- `POST /lgi/coordinators/handovers` — prepare a group handover and atomically transfer its active Coordinator assignment.
- `POST /lgi/coordinators/handovers/:handoverId/cancel` — cancel a pending handover and safely roll back the assignment when possible.
- `GET /coordinator/handovers` — list handovers assigned to the authenticated incoming Coordinator.
- `POST /coordinator/handovers/:handoverId/accept` — acknowledge a pending handover assigned to the authenticated Coordinator.

The API validates every group against the caller's assigned LGA(s). It rejects inactive groups and active group assignments owned by another coordinator. The database's partial unique index remains the final concurrency safeguard for one active coordinator per group.

## Local development

Apply the new `0004_cds_group_handovers` and `0005_handover_standby_restore` migrations before testing the handover screens:

```bash
bun run --filter @nysc/database db:migrate
```

Start the API and web app, sign in as an LGI administrator, open `/lgi/coordinators`, and use **Transfer responsibility** on an active group assignment. The incoming Coordinator must have an active account and an active Coordinator role assignment in the same LGA. They may be a standby Coordinator with no group assignment; a different CDS group is not required. To create one, use **Add coordinator**, select **Create as a standby Coordinator**, choose the LGA, and activate the account. The standby assignment is converted into the transferred group's assignment during handover. Sign in as that Coordinator to review and accept the handover at `/coordinator/handovers`.

The transfer changes the active assignment immediately when the LGI submits it; acceptance records that the incoming Coordinator has reviewed and acknowledged the handover. Do not interpret acceptance as an NYSC clearance or official approval.

Run the API and frontend, then sign in as an LGI administrator and open:

`http://localhost:5173/lgi/coordinators`

When a new or pending account is invited in development, the screen displays its activation token once. Activate that account from the local project environment:

```bash
python3 scripts/activate-account.py coordinator@example.test
```

Enter the token displayed by the LGI screen and set the coordinator password. Treat the token as a password: do not paste it into chat, issue trackers, or source control.

## Remaining production work

- Integrate a transactional email provider and deliver activation invitations to the verified coordinator email address.
- Add an audited resend-invitation action and a secure coordinator self-service activation/reset experience.
- Build the remaining coordinator-facing group-operations workspace (group dashboard, plans, schedules, attendance and reporting). Every request must enforce group scope server-side.
- Add integration tests for cross-LGA access denial, assignment collisions, transfer atomicity, successor-only handover acceptance, disable/session revocation, reactivation and assignment-history retention.
