-- Backfill accounts created before automatic CDS matching was introduced.
-- Members with any prior membership history are intentionally not re-assigned:
-- they may have declined a group or been deliberately removed by an LGI.
DO $$
DECLARE
  member_record RECORD;
  target_group_id UUID;
BEGIN
  FOR member_record IN
    SELECT
      cm.id,
      cm.lga_id,
      cm.course_id
    FROM corps_members AS cm
    WHERE
      cm.user_id IS NOT NULL
      AND cm.course_id IS NOT NULL
      AND cm.profile_status <> 'rejected'
      AND NOT EXISTS (
        SELECT 1
        FROM cds_group_memberships AS history
        WHERE history.corps_member_id = cm.id
      )
    ORDER BY cm.created_at, cm.id
  LOOP
    target_group_id := NULL;

    SELECT g.id
      INTO target_group_id
    FROM cds_groups AS g
    INNER JOIN cds_group_courses AS gc
      ON gc.cds_group_id = g.id
    LEFT JOIN (
      SELECT
        cds_group_id,
        COUNT(*)::integer AS active_count
      FROM cds_group_memberships
      WHERE status = 'active'
      GROUP BY cds_group_id
    ) AS membership_counts
      ON membership_counts.cds_group_id = g.id
    WHERE
      g.lga_id = member_record.lga_id
      AND g.is_active = TRUE
      AND gc.course_id = member_record.course_id
      AND COALESCE(membership_counts.active_count, 0) < g.max_capacity
    ORDER BY
      COALESCE(membership_counts.active_count, 0)::numeric / g.max_capacity,
      COALESCE(membership_counts.active_count, 0),
      g.created_at,
      g.id
    LIMIT 1
    FOR UPDATE OF g;

    IF target_group_id IS NOT NULL THEN
      INSERT INTO cds_group_memberships (
        cds_group_id,
        corps_member_id,
        status,
        source,
        assigned_by_user_id
      )
      VALUES (
        target_group_id,
        member_record.id,
        'active',
        'automatic',
        NULL
      );
    END IF;
  END LOOP;
END $$;
