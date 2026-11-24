# Five-role acceptance test runbook

**Status:** Prepared; execution results are intentionally left unchecked until a tester runs the scenarios against a live QA environment.

This runbook covers the five implemented workspaces: LGI Administrator, CDS Coordinator, CDS President, Corps Member and Corps Liaison Officer (CLO). It is based on the current user guides and API route/authorization structure.

> **Safety:** Run these tests only in a disposable development or QA database with synthetic records. Do not run setup, upload test files or exercise lockout/clearance actions against production records.

## 1. Test environment

### Start the local stack

From the repository root:

```bash
cp .env.example .env
```

Set unique local values in `.env` for PostgreSQL, Redis, `IDENTITY_VERIFICATION_PEPPER`, `API_RATE_LIMIT_PEPPER` and `OTP_HASH_PEPPER`. Keep `NODE_ENV=development` (or unset), `OTP_DELIVERY_MODE=console` and `DOCUMENT_VERIFICATION_MODE=manual` for the baseline run. Do not commit `.env` or paste tokens, OTPs or passwords into an issue.

Start infrastructure and apply the database setup:

```bash
bun install --frozen-lockfile
docker compose up -d postgres redis
bun run --filter @nysc/database db:migrate
bun run --filter @nysc/database db:seed
```

Run the API and web app in separate terminals:

```bash
bun run dev:api
```

```bash
bun run dev:web
```

Use the Vite web URL shown in the terminal (normally `http://localhost:5173`). The API is normally available at `http://localhost:3001`.

### Important: seed accounts are not login-ready

The standard development seed creates these accounts in `pending_activation` state:

- `lgi.demo@example.test`
- `coordinator.demo@example.test`
- `president.demo@example.test`

It also creates five **preloaded, unlinked** Corps Member records. It does not create a CLO account. The seeded President account has no group-scoped President assignment or active leadership designation, so it is not suitable for testing a President workspace.

Do not assume there is a default password. Activate only QA accounts using the development activation flow. For the initial LGI test account, generate a one-time development activation token:

```bash
bun apps/api/src/scripts/create-activation-token.ts lgi.demo@example.test
```

The script prints the token once and it expires after 30 minutes. Activate the account through the API:

```bash
curl -sS -X POST http://localhost:3001/auth/activate \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "email": "lgi.demo@example.test",
  "token": "PASTE_THE_ONE_TIME_TOKEN",
  "password": "USE_A_UNIQUE_QA_PASSWORD_OF_12_OR_MORE_CHARACTERS"
}
JSON
```

Use a unique password and do not reuse a production credential. The `/auth/activate` endpoint requires the token, email and a password of 12–128 characters. Coordinator and CLO accounts created in the development UI expose a one-time activation token in their development response; activate those QA accounts with the same endpoint. Never use development token generation or console OTP delivery in production.

### Create the Corps Member QA login

Use the first synthetic preloaded record from the seed:

| Field | QA value |
|---|---|
| State Code | `DEMO/26A/001` |
| Date of Birth | `2000-04-12` |
| Call-up Number | `DEMO-CALLUP-001` |
| Name | Amina Bello |
| Email on the preloaded record | `amina.bello@example.test` |

Open `/register/corps-member`, enter the three identity values exactly, request the email OTP and read the six-digit code from the API terminal's `[DEV OTP]` log. Complete OTP verification and set a unique QA password. This is a test identity only.

The identity challenge is valid for 10 minutes; the OTP expires after 5 minutes. Do not intentionally exhaust identity attempts during the main run. The documented lockout sequence belongs in a separate disposable-record test.

### Prepare the minimum group fixture

Using the LGI workspace:

1. Confirm the seeded 2026 / Batch A / Stream I cohort and Demo LGA exist.
2. Create one active CDS group (for example, `QA-GRP-01`) with capacity comfortably above the test roster.
3. Map the Computer Science course to that group.
4. Add the registered Amina QA member to the group using the LGI membership workflow.
5. Create and publish at least one active mandatory document requirement for Demo LGA, using a safe synthetic test document format and size.
6. Create one Coordinator account and assign it to `QA-GRP-01`. Activate the account.
7. Create one CLO account through the LGI CLO workflow and activate it.

The Coordinator will designate Amina as President later in the workflow. This tests the supported dual-role pattern (one Corps Member account with an additional group-scoped President role) and avoids using the unscoped `president.demo@example.test` seed placeholder.

For the CLO platform-wide scope test, prepare a second synthetic LGA and at least one member/document submission in that LGA using a separate QA fixture or authorized LGI test account. The standard seed creates only Demo LGA; a single-LGA run cannot prove cross-LGA coverage.

## 2. Acceptance scenarios

Mark each case **Pass**, **Fail** or **Blocked** and record the evidence/issue number. A page rendering is not enough for a workflow: confirm the resulting state in the next role's workspace as described.

### A. LGI Administrator — `/lgi`

| ID | Action | Expected result | Result |
|---|---|---|---|
| LGI-01 | Sign in with the activated LGI QA account. | LGI dashboard loads and identifies the signed-in account. | ☐ |
| LGI-02 | Open Batches & Streams and inspect the seeded 2026 / Batch A / Stream I records. | Cohort records are visible; no duplicate is created just by viewing them. | ☐ |
| LGI-03 | Open Corps Members, search for the synthetic Amina record and open its profile. | Only records in the LGI's assigned LGA are available; profile details match the synthetic fixture. | ☐ |
| LGI-04 | Open CDS Groups and inspect `QA-GRP-01`, capacity, course mapping and roster. | Group and mapped course are visible; the roster shows the QA member once. | ☐ |
| LGI-05 | Open Document Requirements and inspect the published mandatory requirement. | Requirement is active and appears in the Corps Member checklist. | ☐ |
| LGI-06 | Open CDS Coordinators and inspect the QA Coordinator assignment. | Coordinator is assigned only to the selected group(s) within the LGI's LGA. | ☐ |
| LGI-07 | Open CLO Officers and inspect the QA CLO assignment. | CLO management scope is visible to the LGI; account can be paused/restored by an authorized LGI. | ☐ |
| LGI-08 | Open Attendance, Reports and Monthly Clearance after an approved attendance register exists. | LGI views the assigned-LGA reports and clearance records; attendance is read-only in the LGI report. | ☐ |
| LGI-09 | Attempt to open a record in an unassigned LGA using a second-LGA fixture. | The record is not disclosed or mutable outside the LGI's LGA scope. | ☐ |

### B. CDS Coordinator — `/coordinator`

| ID | Action | Expected result | Result |
|---|---|---|---|
| CO-01 | Sign in with the activated Coordinator QA account. | Coordinator dashboard loads and lists only assigned groups. | ☐ |
| CO-02 | Open the roster for `QA-GRP-01`. | Amina appears once with the expected member/course information. | ☐ |
| CO-03 | Designate Amina as President. | Amina is selected from the existing active roster; no duplicate person/member account is created. | ☐ |
| CO-04 | Replace the President with another eligible synthetic member, supplying a reason of at least 10 characters. | Replacement is confirmed and leadership history retains the previous designation and reason. | ☐ |
| CO-05 | Save a controlled QA WhatsApp invite link and nominate a group assistant from the roster. | Settings save for the assigned group only; invalid links are rejected. | ☐ |
| CO-06 | Change the assistant, then remove the assistant and invitation link. | Changes persist; the Corps Member portal no longer offers Join WhatsApp Group after the link is removed. | ☐ |
| CO-07 | Schedule a meeting for `QA-GRP-01` with a valid start/end time. | Meeting appears in Coordinator and President meeting lists. | ☐ |
| CO-08 | Review the President-submitted attendance register and return it with a correction note. | Register moves to returned/correction state and the President can edit and resubmit it. | ☐ |
| CO-09 | Approve the corrected register. | Register becomes approved/reviewed and locked; approved attendance is visible to the member and LGI report. | ☐ |
| CO-10 | Submit a Coordinator announcement to the assigned QA group. | Announcement is published to the selected group and appears for its member(s). | ☐ |
| CO-11 | Open a second group not assigned to this Coordinator. | The group and its operational data are not accessible or manageable. | ☐ |

Use a disposable WhatsApp test group only. Do not paste a real community invite link into screenshots, logs or defect reports.

### C. CDS President — `/cds-president`

| ID | Action | Expected result | Result |
|---|---|---|---|
| PR-01 | Sign in as the Corps Member designated President by the Coordinator. | President dashboard loads; the same account can also open the Corps Member portal. | ☐ |
| PR-02 | Inspect the President dashboard and roster. | Only group(s) with an active President designation are shown. | ☐ |
| PR-03 | Open the scheduled QA meeting and open the attendance register. | Register is available for the assigned group and current active roster. | ☐ |
| PR-04 | Mark roster members Present, Absent, Late and Excused as appropriate. | Each saved mark is reflected in the meeting register. | ☐ |
| PR-05 | Submit the completed register. | Register is submitted to the Coordinator and is no longer freely editable while awaiting review. | ☐ |
| PR-06 | After the Coordinator returns it, correct a mark and resubmit. | Updated register is resubmitted successfully. | ☐ |
| PR-07 | Submit an announcement with title, body, priority and optional expiry. | Announcement is pending Coordinator review and is not yet visible as published to members. | ☐ |
| PR-08 | Attempt member/group administration or another group's attendance. | President cannot change membership, map courses, designate another President or operate outside active President group(s). | ☐ |

### D. Corps Member — `/corps-member`

| ID | Action | Expected result | Result |
|---|---|---|---|
| CM-01 | Sign in using the newly registered synthetic member account. | Member portal loads and shows the linked NYSC record; the user has one member identity. | ☐ |
| CM-02 | Inspect profile, assigned CDS group, group contacts and course. | Details match the LGI-managed record and group assignment. | ☐ |
| CM-03 | Inspect Required Documents. | Published requirements, mandatory flags, accepted file types/size and current submission status are visible. | ☐ |
| CM-04 | Upload a valid synthetic file for the requirement. | Submission is accepted and its status/verification note is shown. | ☐ |
| CM-05 | Upload an invalid type or over-limit file in a separate test attempt. | Upload is rejected with a useful validation message; no valid submission is overwritten. | ☐ |
| CM-06 | Where the reviewer requests resubmission, upload a corrected file. | Latest submission is visible to the authorized human reviewer. | ☐ |
| CM-07 | Inspect WhatsApp access before and after the Coordinator configures/removes the invite link. | Join WhatsApp Group appears only while the assigned group's invitation link is configured. | ☐ |
| CM-08 | Open Announcements and read the published Coordinator announcement. | Only announcements targeted to the member's assigned group/LGA are shown. | ☐ |
| CM-09 | Inspect Attendance after the Coordinator approves the register. | Approved attendance history is visible and read-only. | ☐ |
| CM-10 | Decline the active CDS group with a valid reason and notes, using a separate test member if needed. | Decline is recorded and the member no longer appears as an active placement in that group; LGI can review the declined placement. | ☐ |
| CM-11 | If the member also holds President access, switch to President workspace and back. | Both workspaces use the same account and member record. | ☐ |

### E. Corps Liaison Officer (CLO) — `/clo/documents`

| ID | Action | Expected result | Result |
|---|---|---|---|
| CLO-01 | Sign in with the activated CLO QA account. | CLO document workspace loads. | ☐ |
| CLO-02 | Inspect active document requirements. | Active requirements are visible as read-only reference data. | ☐ |
| CLO-03 | Inspect submissions from the primary and second synthetic LGA. | Submissions from both LGAs are available in the CLO queue (platform-wide coverage). | ☐ |
| CLO-04 | Open a Manual or AI-assisted submission and inspect the actual file. | File opens with private/no-store response behaviour; review action is available where human review is pending. | ☐ |
| CLO-05 | Mark a reviewable submission verified with a note of at least 10 characters. | Decision succeeds and reviewer/time are recorded; matching outcome is communicated where applicable. | ☐ |
| CLO-06 | Return a different reviewable submission with a correction note of at least 10 characters. | Member sees resubmission requested and can upload a corrected file. | ☐ |
| CLO-07 | Inspect an AI Auto rejection, if that mode and a safe test provider are configured. | AI Auto rejection is labelled as awaiting human override where applicable and exposes the human review action. | ☐ |
| CLO-08 | Attempt to create, edit, enable or remove document requirements as CLO. | No mutation control is available; server does not accept CLO requirement-management operations. | ☐ |
| CLO-09 | Have an LGI outside the CLO management assignment attempt to manage the CLO account. | That LGI cannot change the CLO account; the CLO's own review scope remains platform-wide. | ☐ |

The baseline run uses Manual mode. AI Auto cases are optional and **Blocked** unless a dedicated QA provider/key and synthetic documents are configured. Never send real member documents to an external AI provider as part of this test.

## 3. Role authorization smoke test

Run this in the browser DevTools Console while signed in as each QA role. Same-origin `fetch` sends the current session cookie. It checks the backend routes, not just whether a navigation link is hidden.

```js
const paths = [
  "/lgi/cds-groups",
  "/coordinator/groups",
  "/cds-president/groups",
  "/corps-member/portal",
  "/clo/documents/submissions"
];

await Promise.all(paths.map(async (path) => {
  const response = await fetch(`/api${path}`);
  return { path, status: response.status };
}));
```

Expected status by active role (assuming the matching test fixture is present):

| Signed-in role | LGI groups | Coordinator groups | President groups | Member portal | CLO submissions |
|---|---:|---:|---:|---:|---:|
| LGI Administrator | 200 | 403 | 403 | 403 | 403 |
| CDS Coordinator | 403 | 200 | 403 | 403 | 403 |
| CDS President | 403 | 403 | 200 | 403 | 403 |
| Corps Member | 403 | 403 | 403 | 200 | 403 |
| CLO | 403 | 403 | 403 | 403 | 200 |
| Signed out | 401 | 401 | 401 | 401 | 401 |

A request for the signed-in role's allowed route can still fail with a server/data error when its required fixture is missing; resolve that fixture before marking the authorization test as failed. The cross-role 403 and signed-out 401 results are the permission assertions.

## 4. Notifications and session checks

For each role that has notifications:

1. Trigger a relevant test notification (for example, a meeting scheduled/submitted, announcement or review decision).
2. Confirm the bell/unread count updates for the intended recipient(s), not unrelated roles/groups.
3. Open the notification centre, mark one item read and confirm the unread count changes.
4. Use Mark all as read and confirm the list/count is updated.
5. Sign out, then open the role URL directly in a fresh browser context. The signed-out session must not retain access to protected API data.

## 5. Evidence and completion record

Record the following with every run:

| Field | Value |
|---|---|
| Tester |  |
| Date/time (Africa/Lagos) |  |
| Environment / URL |  |
| Git commit SHA |  |
| Database | Disposable QA database name (no credentials) |
| OTP mode | Console / provider (provider name only; no keys) |
| Document verification mode | Manual / AI Auto / AI + LGI Approval |
| Second-LGA fixture prepared | Yes / No |
| Result summary | Pass / Fail / Blocked |
| Defect links |  |

Attach screenshots only after removing/blurred member personal details, OTPs, session data, activation tokens, file contents and invite links. Never attach `.env`, database dumps or real member documents.

**Release decision:** do not describe the five-role E2E acceptance as complete until the role scenarios and authorization matrix have been executed against a live QA stack and failures have been triaged. Passing CI unit/build/migration checks does not substitute for this run.
