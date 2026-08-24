-- 0001_extensions.sql
--
-- Enables the two Postgres extensions the schema depends on (SPEC.md §0.1).
-- Both must exist before any table that uses them; creating them here, ahead
-- of the first table, keeps that ordering explicit.
--
-- btree_gist — required by the overlap exclusion constraint on time_entries
--              (SPEC.md §3.7). Without it that constraint fails to create.
-- citext     — required by invitations.email (SPEC.md §3.10), so that
--              invitation lookups are case-insensitive without lower() calls
--              scattered through every query.
--
-- Reversibility: dropping either extension would break the constraints and
-- columns that depend on it. Nothing is lost by applying this migration.

create extension if not exists btree_gist;
create extension if not exists citext;
