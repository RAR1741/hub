-- An admin "resolves" a flagged session by saving it (see updateSession). Once
-- resolved, the flagged-sessions screen hides it even if it still carries a flag
-- (e.g. an over_max shift the admin reviewed and accepted). A re-import replaces
-- a period's source='import' rows wholesale (delete + insert), so a re-imported
-- session is a fresh row with flags_resolved_at NULL and flags again — which is
-- exactly the desired "re-import surfaces it once more" behavior.
alter table session add column flags_resolved_at timestamptz;
