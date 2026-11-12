INSERT INTO "roles" ("code", "name", "description")
VALUES (
  'CLO',
  'Corps Liaison Officer',
  'Manages document submissions and verification within assigned LGA(s); cannot configure document requirements'
)
ON CONFLICT ("code") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description";