# Shared Course Catalogue

## Ownership and access

The course catalogue is one shared reference dataset used by every LGA. It is managed from the existing LGI administration module at `/lgi/course-catalogue`.

- `LGI_ADMIN` users with an active LGA assignment can create, edit, deactivate/reactivate and bulk-import courses and aliases.
- Catalogue changes are global: adding, editing or deactivating a course affects the shared list used by all LGAs.
- LGI administrators continue to manage CDS groups and other operational records only within their assigned LGA(s).
- CDS Coordinators, CDS Presidents and corps members cannot manage catalogue records.

There is no separate Platform Administrator account or login. The development seed removes the legacy `platform.admin@example.test` account and removes the old `PLATFORM_ADMIN` role if it has no remaining assignments.

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

## LGI course-catalogue API

All management routes require an authenticated `LGI_ADMIN` role with at least one active LGA assignment:

- `GET /lgi/course-catalogue/categories`
- `GET /lgi/course-catalogue?q=&category=&status=`
- `POST /lgi/course-catalogue`
- `PATCH /lgi/course-catalogue/:courseId`
- `POST /lgi/course-catalogue/import`
- `GET /lgi/course-catalogue/template`

Course creation accepts `name`, `disciplineCategory` and optional `aliases`. Updates can change the canonical name, category, aliases and active status. Deactivation is preferred to deletion because existing corps-member and CDS-group records may refer to the course.

The catalogue is shared globally even though the management screen is part of the LGI module. The UI states this before changes are made: a catalogue edit by an LGI administrator is visible to all LGAs.

## CDS Group course selection

The same LGI route `GET /lgi/course-catalogue?q=&category=&status=active` supplies the CDS Group form. It returns active courses only and supports search across canonical names and aliases. The group form provides category filtering, multi-select, and select/clear-visible actions.

The server enforces LGI authorization. CDS group operations additionally verify the authenticated LGI's assigned LGA scope.

## CSV import format

Download the CSV template from the LGI Course Catalogue screen. Required headers:
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

Use a UTF-8 CSV. Review the import summary and search the catalogue after import. Remember that imported changes update the shared catalogue for every LGA.

## Development setup

After pulling this branch, from the repository root:

1. Confirm the `course_aliases` migration has been applied:

   ```bash
   bun run --filter @nysc/database db:migrate
   ```

2. Run the development seed. It adds representative starter catalogue records and removes the obsolete Platform Administrator demo account:

   ```bash
   bun run --filter @nysc/database db:seed
   ```

3. Sign in through `/login` with an account that has an active `LGI_ADMIN` assignment. The seed account is `lgi.demo@example.test`; for a local development database that still has it pending activation, generate a one-time activation token with:

   ```bash
   bun run apps/api/src/scripts/create-activation-token.ts lgi.demo@example.test
   python3 scripts/activate-account.py lgi.demo@example.test
   ```

   Keep the token private and do not paste it into chat or commit it. Never run the demo seed against production data.

The demo seed is for local development only. The starter catalogue is representative and should be replaced or augmented with a reviewed, authoritative course dataset supplied or approved by the operating organisation.

## Implementation checks

Before production:
- Test that an LGI with an active LGA assignment can manage the shared catalogue and an account without an LGI LGA assignment receives 403.
- Test canonical/alias collision handling under concurrent requests.
- Test CSV quoting, CRLF, invalid headers, oversized files, row limits and transaction rollback.
- Test that CDS group selection returns active courses only.
- Test inactive courses are excluded from new CDS-group course selection but remain attached to historical records.
- Add a paginated list if the catalogue grows beyond a manageable response size.
