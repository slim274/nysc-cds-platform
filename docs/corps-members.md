# Corps member import, export and photographs

## LGI member directory

The LGI Corps Members page supports manual records, CSV bulk import, filtered CSV export and profile photographs. All routes require an authenticated `LGI_ADMIN` role and enforce the LGA assignment scope of the signed-in user.

## Bulk CSV import

Use **Download template** on the Corps Members page. The import endpoint accepts UTF-8 CSV up to 2 MB and a maximum of 500 member rows per upload.

Required columns:

- `stateCode`
- `firstName`
- `lastName`
- `lgaName`
- `lgaState`
- `serviceYear`
- `batchCode`
- `streamCode`

Optional columns:

- `callUpNumber`
- `email`
- `phone`
- `middleName`
- `dateOfBirth` (YYYY-MM-DD)
- `gender`
- `institutionName`
- `courseName`
- `qualification`
- `graduationYear`
- `profileStatus` (`preloaded`, `draft`, `submitted`, `approved`, or `rejected`; defaults to `preloaded`)

The LGA must match an active LGA assigned to the importing LGI. Batch and stream must resolve to an active NYSC service year, batch and stream. Institution and course names must already exist as active catalogue records. Optional institution and course values may be left blank.

State codes are normalised to uppercase. A row with a state code that already exists within the LGI's assigned LGA scope updates that member record; otherwise a new member is created. A state code already belonging to a different LGA outside the LGI's scope is rejected. Duplicate state codes or call-up numbers in the uploaded file, unknown references, invalid dates and database uniqueness conflicts cause the complete transaction to roll back.

The API reports created, updated and total processed counts. Email and phone are optional CSV fields. Contact details are stored as supplied by the LGI and are not considered verified until the member completes an OTP challenge during account onboarding. The import does not include photos; photographs are uploaded through the member record form.

## CSV export

Export uses the current directory filters (search, LGA, batch/stream and profile status). The endpoint exports up to 10,000 matching records in one file. Apply narrower filters when the result is larger.

CSV cells are quoted and escaped, and leading spreadsheet formula characters are neutralised to reduce CSV formula injection risk. The export includes member identity, contact details, deployment, institution/course, qualification, graduation year and profile status. It does not include photographs, storage paths, passwords or authentication data.

## Profile photographs

The member form accepts one JPEG, PNG or WebP photograph up to 5 MB. The API checks the actual file signature rather than trusting only the browser-supplied MIME type. Stored files receive random server-generated names and are not served from a public static directory.

Photo upload and retrieval use authenticated, LGA-scoped routes:

- `POST /lgi/corps-members/:memberId/photo`
- `GET /lgi/corps-members/:memberId/photo`

Only a boolean `hasPassportPhoto` is exposed to the browser; the storage key is kept server-side.

### Storage configuration

Set `CORPS_MEMBER_PHOTO_DIR` to the private directory used for profile photos. The development default is `.data/corps-member-photos` relative to the API process working directory. The application applies directory mode 0700 and file mode 0600 where supported. The `.data/` path is ignored by Git.

The current adapter is local-filesystem storage for development and single-instance deployments. Before deploying to ephemeral containers or multiple API instances, provision a persistent, private, encrypted storage volume or replace the adapter with a shared private object-storage provider. The photo endpoint must remain authenticated; do not publish this directory through a static web server or public CDN. Include the storage in the authorised backup, retention and deletion procedures.

## Facial recognition is not enabled

This release stores and displays a profile photograph only. It does not generate face templates or embeddings, compare faces, make identity matches, or use photographs to make attendance or disciplinary decisions.

Facial recognition for unique identification is a separate biometric-processing feature. The Nigeria Data Protection Act defines biometric data to include data produced by technical processing of facial images to identify a person and classifies biometric data used for unique identification as sensitive personal data. The Act's section 30 conditions for sensitive-data processing and the NDPC's GAID 2025 Article 28 DPIA requirements must be assessed before that feature is designed or deployed. The DPIA should address necessity and proportionality, a lawful basis, a clear data-subject notice, retention and deletion, security and processor arrangements, false-match and disparate-impact risks, human review, an appeal/correction path and a practical non-biometric alternative.

Do not enable automatic face matching or use it as the sole basis for attendance, clearance or other decisions until the responsible data controller and its qualified privacy/legal advisers have approved the purpose, lawful basis, DPIA and safeguards.

## Pre-onboarding identity verification

The public endpoint `POST /auth/verify-corps-member` checks a corps-member's State Code, Date of Birth and Call-up Number before the later OTP onboarding step. It does not create a user account, set a password, send an OTP or perform facial recognition.

Request:

```json
{
  "stateCode": "AB/26A/001",
  "dateOfBirth": "2000-04-12",
  "callUpNumber": "CALLUP-001"
}
```

The endpoint normalises State Code and Call-up Number to uppercase and trims whitespace. A record is eligible only when all three values match, its `user_id` is null, and its profile has not been rejected.

The endpoint always returns the same successful response shape and generic message for a matching or non-matching identity. It returns a cryptographically random 256-bit challenge token that expires after 10 minutes. The database stores only the token hash. For a non-match, the token is deliberately stored against a null member reference and cannot be used by a subsequent verification step. This prevents the identity endpoint from revealing whether a submitted combination exists in the member directory.

Example response:

```json
{
  "success": true,
  "message": "If the details match an eligible corps member record, you can continue verification.",
  "data": {
    "challengeToken": "<opaque-64-character-token>",
    "expiresInSeconds": 600
  }
}
```

Persistent throttling is enforced in PostgreSQL: up to five attempts per identity combination and 20 attempts per client address in a rolling 15-minute window, followed by a 15-minute block. The rate-limit table stores HMAC digests rather than raw identity values or IP addresses. Configure `IDENTITY_VERIFICATION_PEPPER` to a unique secret of at least 32 bytes; generate one with:

```bash
openssl rand -hex 32
```

Set `TRUST_PROXY_HEADERS=true` only when the API is behind a trusted reverse proxy that removes any incoming client-supplied `X-Forwarded-For` header and writes its own. Otherwise, leave it false; the API will rate-limit using the socket peer address.

The challenge token is intended for the next OTP verification stage. Do not treat it as proof of verified email/phone ownership or as an authenticated session. OTP delivery, challenge consumption, account creation and facial/biometric verification are not implemented by this endpoint.

