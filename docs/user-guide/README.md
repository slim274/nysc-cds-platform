# NYSC CDS Platform — User Guides

This guide set explains the workflows available in the current development application. It is written for staff and Corps Members using the web interface; implementation and API details remain in the supporting technical documents.

## Start here

1. [Sign-in and Corps Member account registration](authentication.md)
2. Choose the guide for your role:
   - [LGI Administrator](lgi-administrator.md)
   - [CDS Coordinator](coordinator.md)
   - [CDS President](cds-president.md)
   - [Corps Member](corps-member.md)
   - [Corps Liaison Officer (CLO)](clo.md)
3. [Notifications](notifications.md)

## Role overview

| Role | Main workspace | Primary responsibilities |
|---|---|---|
| LGI Administrator | `/lgi` | Manage records and NYSC cohorts, CDS groups, assignments, document requirements, attendance oversight, clearance and reporting within assigned LGA(s). |
| CDS Coordinator | `/coordinator` | Operate assigned CDS groups, manage President designations and WhatsApp settings, schedule meetings, review attendance and manage group communications. |
| CDS President | `/cds-president` | View assigned group information, record attendance and submit announcements for Coordinator approval. |
| Corps Member | `/corps-member` | View NYSC/CDS information, submit documents, join the assigned WhatsApp group, read announcements and view approved attendance. |
| CLO | `/clo/documents` | Review Corps Member document submissions across all LGAs when the CLO account is enabled. |

## Related technical documentation

- [Five-role acceptance test runbook](../testing/five-role-acceptance.md) — a QA setup and test sequence for all five workspaces.

- [Corps Member import, export, profile photos and onboarding](../corps-members.md)
- [Document verification modes and LGI review](../document-verification.md)
- [Coordinator account lifecycle and handovers](../coordinator-management.md)
- [Shared Course Catalogue](../course-catalogue.md)
- [CDS Group design note](../architecture/cds-group-management.md)
- [Monitoring observations and current repository limitations](../monitoring/README.md)

## Screenshot note

The JPEGs used by the image links in these guides are committed under `docs/assets/screenshots/` in this repository. They are available after cloning or pulling the branch; no separate extraction step is needed. The images were captured from the local development environment with demo data; selected record values have been blurred. A screenshot illustrates a page layout at the time of capture; it is not proof that a service is currently running or that a particular account has production access.

The current set does not include every page. Sections without an image describe the implemented route and workflow based on the application code.
