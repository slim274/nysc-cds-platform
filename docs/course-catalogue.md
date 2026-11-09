# Shared Course Catalogue

## Ownership and access

The course catalogue is a single shared reference dataset across all LGAs.

- `PLATFORM_ADMIN` can create, edit, deactivate/reactivate and bulk-import courses and aliases.
- `LGI_ADMIN` can search active catalogue records and select courses for CDS-group eligibility. LGIs cannot edit the global course list.
- Coordinators and corps members do not manage catalogue records.

The development seed creates `platform.admin@example.test` with a pending-activation account and a global `PLATFORM_ADMIN` role assignment. This is a development-only bootstrap account. Never run the demo seed against production data or use its predictable email for production administration. Production platform-admin access must be granted through an authorised, audited bootstrap process.

## Data model

### Courses

The existing `courses` table remains the canonical course record:
- `name`: preferred display name.
- `normalized_name`: Unicode-normalized, punctuation-insensitive uppercase key used to prevent duplicates.
- `discipline_category`: controlled category code.
- `is_active`: inactive courses remain available for historical references but are hidden from new group eligibility.

### Course aliases

`course_aliases` maps alternate spellings, abbreviations and institution-specific labels to one canonical course. Alias normalized names are unique. The service also checks for collisions between aliases and canonical course names; a database unique index alone cannot enforce cross-table uniqueness.

Aliases do not create new courses. They are for search and future normalization of corps-member course records.

## Discipline categories

The initial controlled category list is:
- Agriculture & Agricultural Sciences
- Arts & Humanities
- Architecture & Built Environment
- Education
- Engineering & Technology
- Environmental Sciences
- Health & Medical Sciences
- ICT & Computing
- Law & Legal Studies
- Management Sciences
- Natural & Physical Sciences
- Pharmaceutical Sciences
- Social Sciences
- Veterinary Medicine
- Unclassified / Other

These are platform grouping categories for administration and CDS eligibility. They are not a claim that every institution's degree nomenclature or NYSC classification is identical. The starter seed is a curated development catalogue, not an exhaustive or official national list.

## Platform Administrator API

All routes are protected by the authenticated `PLATFORM_ADMIN` role:

- `GET /platform/course-catalogue/categories`
- `GET /platform/course-catalogue?q=&category=&status=`
- `POST /platform/course-catalogue`
- `PATCH /platform/course-catalogue/:courseId`
- `POST /platform/course-catalogue/import`
- `GET /platform/course-catalogue/template`

Course creation accepts `name`, `disciplineCategory` and optional `aliases`. Updates can change the canonical name, category, aliases and active status. Deactivation is preferred to deletion because existing corps-member and CDS-group records may refer to the course.

## LGI access

LGI-only route:
- `GET /lgi/course-catalogue?q=&category=`

It returns active courses only. The CDS Group form uses this endpoint to provide search across canonical names and aliases, category filtering, multi-select, and select/clear-visible actions.

LGIs cannot submit catalogue mutations. The API applies role checks; hiding controls in the browser is not the security boundary.

## CSV import format

Download the CSV template from the Platform Administrator screen. Required headers:
- `name`
- `disciplineCategory`

Optional header:
- `aliases`

Example:

```csv
name,disciplineCategory,aliases
Computer Science,ICT,"Computing|Computer Studies"
Civil Engineering,ENGINEERING,"Civil Eng|BEng Civil Engineering"
```

Rules:
- CSV upload limit: 1 MB.
- Maximum rows: 1,000 per upload.
- Alias values within a cell are separated by `|`.
- Category codes must match the controlled category list.
- Existing canonical names are updated and reactivated.
- New canonical names are inserted.
- Existing aliases are retained; new aliases are added.
- Duplicate canonical names, duplicate normalized aliases and cross-course collisions reject the whole import transaction.
- Inactive courses can be reactivated through an import row or the edit screen.

Use a UTF-8 CSV. Review the import summary and search the catalogue after import.

## Development setup

After pulling this branch:

1. Generate and review the Drizzle migration for `course_aliases`.
2. Apply the migration.
3. Run the development seed to create the Platform Administrator role/account and starter catalogue records.
4. Generate a development activation token for `platform.admin@example.test` with the existing development-only activation-token script.
5. Activate the demo account using the existing activation flow.
6. Sign in; Platform Administrators are routed to `/platform/course-catalogue`.

The seed contains representative starter courses across the categories. It is deliberately not described as complete. For a real deployment, import a reviewed, authoritative course dataset supplied/approved by the operating organisation.

## Implementation checks

Before production:
- Test canonical/alias collision handling under concurrent requests.
- Test CSV quoting, CRLF, invalid headers, oversized files, row limits and transaction rollback.
- Test that LGI can read active courses but receives 403 on Platform Admin routes.
- Test inactive courses are excluded from new CDS-group course selection but remain attached to historical records.
- Add a paginated list if the catalogue grows beyond a manageable response size.
