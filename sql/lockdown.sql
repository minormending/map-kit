-- map-kit: stop new tables being readable and writable by default.
--
-- Generated from @minormending/map-kit. No substitutions.
--
-- Apply this FIRST, before any file that creates a table.
--
-- Supabase ships default privileges that grant anon and authenticated every
-- privilege on each new table in `public`. Every other file in this kit now
-- revokes its own tables explicitly, so the kit is safe whether or not you use
-- this one — but that only covers the kit's tables. Yours are still being
-- granted away as you create them, and a table you never thought about is
-- exactly the one nobody checks.
--
-- Row-level security usually saves you, which is what makes this easy to miss:
-- the grant is there, the policy denies, and the API returns an empty list. It
-- stops saving you at a view. A view runs as its definer unless declared
-- security_invoker, so a readable view over a locked table hands back every
-- row it was built from.
--
-- Applying this does not revoke anything already granted. Run it first, or run
-- the explicit revokes in the other files after.

set search_path = public, extensions;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Functions are different: a security-definer function is the intended door
-- through a locked table, and each one here grants execute deliberately. The
-- default is left alone so that pattern keeps working.
