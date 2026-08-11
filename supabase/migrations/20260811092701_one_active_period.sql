-- At most one active period — a DB invariant that kills the non-transactional
-- clear-then-set race in setActivePeriod. Partial unique index: only rows where
-- is_active is true participate, so many inactive periods coexist.
create unique index one_active_period on period ((is_active)) where is_active;
