-- Re-grant the Supabase API service role on a fresh database.
--
-- Every table in this app is service-role-only: RLS is enabled with ZERO
-- policies, and all access goes through getDb() (the service-role client),
-- which has BYPASSRLS. BYPASSRLS skips ROW policies but NOT table-level
-- GRANTs. The base Supabase image grants the API roles via default
-- privileges on schema public, but `supabase db reset` drops and recreates
-- the public schema, which discards those default privileges. On a database
-- reset this way (CI, and any freshly-provisioned project that doesn't
-- inherit the dashboard defaults) that leaves service_role with no table
-- privileges, so every getDb() query fails with `42501 permission denied`.
--
-- This migration runs last, so it re-establishes the grants on every table
-- created by the earlier migrations, plus default privileges so future
-- tables inherit them. It grants ONLY service_role: anon/authenticated get
-- nothing, so the RLS default-deny posture for any client path is preserved.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all routines in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on routines to service_role;
