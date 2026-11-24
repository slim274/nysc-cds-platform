-- Regression test for migration 0011.
-- A member allocated before document verification was introduced must keep
-- their current active CDS membership when the document tables are added.
\set ON_ERROR_STOP on

CREATE TABLE public.lgas (id uuid PRIMARY KEY);
CREATE TABLE public.users (id uuid PRIMARY KEY);
CREATE TABLE public.corps_members (id uuid PRIMARY KEY);

CREATE TABLE public.cds_group_memberships (
  id uuid PRIMARY KEY,
  source varchar(20) NOT NULL,
  status varchar(20) NOT NULL
);

INSERT INTO public.cds_group_memberships (id, source, status) VALUES
  ('00000000-0000-0000-0000-000000000001', 'automatic', 'active'),
  ('00000000-0000-0000-0000-000000000002', 'manual', 'active');

\ir 0011_corps_member_documents.sql

DO $$
DECLARE
  total_memberships integer;
  active_automatic_memberships integer;
BEGIN
  SELECT count(*) INTO total_memberships
  FROM public.cds_group_memberships;

  SELECT count(*) INTO active_automatic_memberships
  FROM public.cds_group_memberships
  WHERE source = 'automatic' AND status = 'active';

  IF total_memberships <> 2 OR active_automatic_memberships <> 1 THEN
    RAISE EXCEPTION
      'Migration 0011 must preserve existing memberships; total=%, active automatic=%',
      total_memberships,
      active_automatic_memberships;
  END IF;
END $$;
