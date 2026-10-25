-- Remove accidental anonymous access from the exposed public schema.
-- Keep published recruitment copy readable, but never writable by anon.

-- Column grants are independent of table grants in PostgreSQL; revoke both.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(grantee.rolname) END AS role_name,
      acl.privilege_type,
      string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) AS columns
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
    LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND (acl.grantee = 0 OR grantee.rolname = 'anon')
      AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
    GROUP BY n.nspname, c.relname, acl.grantee, grantee.rolname, acl.privilege_type
  LOOP
    EXECUTE format(
      'REVOKE %s (%s) ON TABLE %I.%I FROM %s',
      item.privilege_type,
      item.columns,
      item.schema_name,
      item.table_name,
      item.role_name
    );
  END LOOP;
END
$$;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, PUBLIC;

-- This view must enforce the caller's RLS on its underlying tables.
ALTER VIEW public.production_video_history SET (security_invoker = true);

-- Read-only access to the published recruitment page. RLS still limits rows
-- to is_published = true; only the page content columns are exposed.
GRANT SELECT (
  is_published,
  headline,
  intro,
  video_url,
  video_title,
  flexible_form_url,
  stable_form_url,
  flexible_enabled,
  stable_enabled,
  styles,
  benefits,
  process_steps,
  public_slug
) ON TABLE public.editor_recruitment_funnel_config TO anon;

-- Analytics and maintenance RPCs remain available to authenticated app users;
-- anonymous callers must not execute them.
GRANT EXECUTE ON FUNCTION public.process_closed_pack_renewals() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_complementary_service_schedule() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.track_editor_recruitment_event(uuid, text, jsonb) FROM anon, PUBLIC, authenticated;

-- Views are read-only API surfaces and always use invoker privileges.
REVOKE ALL PRIVILEGES ON TABLE
  public.editor_monthly_metrics,
  public.editor_monthly_performance,
  public.editorial_monthly_metrics,
  public.editorial_monthly_ranking_v2_metrics,
  public.production_video_history
FROM anon, PUBLIC, authenticated;

ALTER VIEW public.editor_monthly_metrics SET (security_invoker = true);
ALTER VIEW public.editor_monthly_performance SET (security_invoker = true);
ALTER VIEW public.editorial_monthly_metrics SET (security_invoker = true);
ALTER VIEW public.editorial_monthly_ranking_v2_metrics SET (security_invoker = true);

GRANT SELECT ON TABLE
  public.editor_monthly_metrics,
  public.editor_monthly_performance,
  public.editorial_monthly_metrics,
  public.editorial_monthly_ranking_v2_metrics,
  public.production_video_history
TO authenticated;

-- Future public-schema objects start closed. New migrations must explicitly
-- grant each required role after enabling RLS and writing its policies.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, PUBLIC;

