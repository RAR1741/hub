-- Re-declare merge_person (latest declaration: 20260906130000_tool_maintenance.sql) to close the
-- FK gaps tracked in #283 and the integration-link gap in #284. merge_person is a hardcoded list
-- of `update ... set col = p_winner` statements, so every person FK added since it was written
-- either aborted the merge (RESTRICT -> 23503 on the final `delete from person`) or, worse,
-- silently cascade-deleted the loser's history along with the loser row.
--
-- Newly reassigned, RESTRICT (the merge used to abort):
--   event.created_by, badge.created_by, badge_award.awarded_by, form.created_by,
--   form_response.person_id
-- Newly reassigned, CASCADE (the merge used to destroy these silently):
--   event_signup.person_id, event_signup_reminder.person_id, badge_award.person_id,
--   push_subscription.person_id, onshape_connection.person_id
-- Still left to cascade away on purpose (short-lived or pair-scoped, no history to keep):
--   login_otp, masquerade_session, person_merge_rejection
--
-- Also fixes two collisions that raised 23505 mid-merge (`one_session_per_person_per_event`) or
-- would have (the unique/PK constraints on the tables above), and carries the loser's Slack /
-- GitHub links onto the winner (#284) the same way the loser's email is already carried.
--
-- src/lib/merge-person-fk-coverage.test.ts is the guardrail: it scans every migration for person
-- FKs and fails if one is neither touched here nor explicitly allowlisted, so the next table added
-- cannot reopen this gap unnoticed.
create or replace function merge_person(p_winner uuid, p_loser uuid)
returns void
language plpgsql
as $$
declare
  v_loser_first text;
  v_loser_last text;
  v_loser_email text;
  v_loser_slack text;
  v_loser_github_login text;
  v_loser_github_user_id bigint;
begin
  if p_winner = p_loser then
    raise exception 'cannot merge a person into themselves' using errcode = 'P0001';
  end if;
  if not exists (select 1 from person where id = p_winner) then
    raise exception 'winner % not found', p_winner using errcode = 'P0002';
  end if;
  select first_name, last_name, email, slack_user_id, github_login, github_user_id
    into v_loser_first, v_loser_last, v_loser_email,
         v_loser_slack, v_loser_github_login, v_loser_github_user_id
    from person where id = p_loser;
  if v_loser_first is null then
    raise exception 'loser % not found', p_loser using errcode = 'P0002';
  end if;

  -- session: partial unique `one_open_session_per_person` on (person_id) where
  -- time_out is null. If both have an OPEN session, drop the loser's open one
  -- (a spurious concurrent clock-in) before reassigning so the invariant holds.
  delete from session l
    where l.person_id = p_loser and l.time_out is null
      and exists (select 1 from session w
                  where w.person_id = p_winner and w.time_out is null);
  -- Also partial unique `one_session_per_person_per_event` on (person_id, event_id)
  -- where event_id is not null (20260817182818_events.sql). Both duplicates checking
  -- in to the same event is the same human counted twice, so drop the loser's
  -- check-in; without this the reassignment below raises 23505 and the merge aborts.
  delete from session l
    where l.person_id = p_loser and l.event_id is not null
      and exists (select 1 from session w
                  where w.person_id = p_winner and w.event_id = l.event_id);
  update session set person_id = p_winner where person_id = p_loser;
  update session set edited_by = p_winner where edited_by = p_loser;

  -- team_membership: PK (person_id, team_id). Carry the loser's manager flag
  -- onto the winner's row for shared teams before dropping the loser's dup.
  update team_membership w
    set is_manager = w.is_manager or l.is_manager
    from team_membership l
    where l.person_id = p_loser and w.person_id = p_winner and w.team_id = l.team_id;
  delete from team_membership l
    where l.person_id = p_loser
      and exists (select 1 from team_membership w
                  where w.person_id = p_winner and w.team_id = l.team_id);
  update team_membership set person_id = p_winner where person_id = p_loser;

  -- membership_application: partial unique (person_id, team_id) where pending.
  delete from membership_application l
    where l.person_id = p_loser and l.status = 'pending'
      and exists (select 1 from membership_application w
                  where w.person_id = p_winner and w.team_id = l.team_id
                    and w.status = 'pending');
  update membership_application set person_id = p_winner where person_id = p_loser;
  update membership_application set reviewed_by = p_winner where reviewed_by = p_loser;

  -- excusal: PK (person_id, date).
  delete from excusal l
    where l.person_id = p_loser
      and exists (select 1 from excusal w
                  where w.person_id = p_winner and w.date = l.date);
  update excusal set person_id = p_winner where person_id = p_loser;
  update excusal set created_by = p_winner where created_by = p_loser;

  -- excusal_request: partial unique (person_id, date) where pending.
  delete from excusal_request l
    where l.person_id = p_loser and l.status = 'pending'
      and exists (select 1 from excusal_request w
                  where w.person_id = p_winner and w.date = l.date
                    and w.status = 'pending');
  update excusal_request set person_id = p_winner where person_id = p_loser;
  update excusal_request set reviewed_by = p_winner where reviewed_by = p_loser;

  -- person_guardian: PK (person_id, guardian_id).
  delete from person_guardian l
    where l.person_id = p_loser
      and exists (select 1 from person_guardian w
                  where w.person_id = p_winner and w.guardian_id = l.guardian_id);
  update person_guardian set person_id = p_winner where person_id = p_loser;

  -- first_experience: unique (person_id, level, year).
  delete from first_experience l
    where l.person_id = p_loser
      and exists (select 1 from first_experience w
                  where w.person_id = p_winner and w.level = l.level and w.year = l.year);
  update first_experience set person_id = p_winner where person_id = p_loser;

  -- person_identity: emails are globally unique (no collision). Move to winner
  -- as secondaries; winner keeps its own primary. (The winner adopting the
  -- loser's email as its primary happens AFTER the loser row is deleted below,
  -- so it can't collide with the loser's still-present person.email.)
  update person_identity
    set person_id = p_winner, is_primary = false
    where person_id = p_loser;

  -- account_request / kiosk_device actor columns (RESTRICT).
  update account_request set reviewed_by = p_winner where reviewed_by = p_loser;
  update kiosk_device set created_by = p_winner where created_by = p_loser;

  -- battery_usage: submitter (RESTRICT). See 20260903120000_battery_tracking.sql header for why
  -- this had to be added here rather than left for a future gap-fill.
  update battery_usage set tech_id = p_winner where tech_id = p_loser;

  -- tool_check / tool_delete_request: submitter and reviewer person FKs. Same reasoning as
  -- battery_usage above.
  update tool_check set checked_by = p_winner where checked_by = p_loser;
  update tool_delete_request set requested_by = p_winner where requested_by = p_loser;
  update tool_delete_request set reviewed_by = p_winner where reviewed_by = p_loser;

  -- event: creator (RESTRICT).
  update event set created_by = p_winner where created_by = p_loser;

  -- event_signup: PK (event_id, person_id). Its children (form_response,
  -- event_signup_reminder) reference it by composite FK (event_id, person_id) with
  -- ON DELETE CASCADE and the default ON UPDATE NO ACTION, which rules out a plain
  -- reassignment in either order: updating event_signup first orphans the children
  -- (23503), moving the children first points them at a signup row that does not
  -- exist yet (23503). So copy the winner's signups in, move the children onto them,
  -- then drop the loser's signups -- by which point nothing is left to cascade.
  insert into event_signup (event_id, person_id, created_at)
    select l.event_id, p_winner, l.created_at from event_signup l
    where l.person_id = p_loser
    on conflict (event_id, person_id) do nothing;

  -- event_signup_reminder: PK (event_id, person_id, minutes). Same offset chosen on
  -- both signups keeps the winner's row (pushed_at and all).
  delete from event_signup_reminder l
    where l.person_id = p_loser
      and exists (select 1 from event_signup_reminder w
                  where w.person_id = p_winner and w.event_id = l.event_id
                    and w.minutes = l.minutes);
  update event_signup_reminder set person_id = p_winner where person_id = p_loser;

  -- form_response: partial unique (event_id, person_id) where event_id is not null,
  -- plus a plain person FK (RESTRICT) for non-event responses (event_id null), which
  -- have no uniqueness constraint and just move.
  delete from form_response l
    where l.person_id = p_loser and l.event_id is not null
      and exists (select 1 from form_response w
                  where w.person_id = p_winner and w.event_id = l.event_id);
  update form_response set person_id = p_winner where person_id = p_loser;

  delete from event_signup where person_id = p_loser;

  -- badge / badge_award: creator and awarder are RESTRICT; the award itself is
  -- CASCADE with unique (badge_id, person_id) -- the same badge on both duplicates
  -- keeps the winner's award.
  update badge set created_by = p_winner where created_by = p_loser;
  delete from badge_award l
    where l.person_id = p_loser
      and exists (select 1 from badge_award w
                  where w.person_id = p_winner and w.badge_id = l.badge_id);
  update badge_award set person_id = p_winner where person_id = p_loser;
  update badge_award set awarded_by = p_winner where awarded_by = p_loser;

  -- form: creator (RESTRICT).
  update form set created_by = p_winner where created_by = p_loser;

  -- push_subscription: endpoint is globally unique, so the same device cannot be
  -- registered to both duplicates and there is nothing to pre-clear.
  update push_subscription set person_id = p_winner where person_id = p_loser;

  -- onshape_connection: person_id is itself unique. The winner's own connection wins;
  -- the loser's OAuth tokens die with the loser row and Onshape can be reconnected.
  delete from onshape_connection l
    where l.person_id = p_loser
      and exists (select 1 from onshape_connection w where w.person_id = p_winner);
  update onshape_connection set person_id = p_winner where person_id = p_loser;

  -- Re-parent the loser's existing aliases, then record the loser's own name.
  -- name_key is globally unique; on collision the alias already resolves
  -- somewhere, so skip.
  update person_name_alias set person_id = p_winner where person_id = p_loser;
  insert into person_name_alias (person_id, first_name, last_name)
    values (p_winner, v_loser_first, v_loser_last)
    on conflict (name_key) do nothing;

  delete from person where id = p_loser;

  -- Restore the #32 exactly-one-primary invariant: if the winner had NO email
  -- of its own (e.g. a name-only time-import auto-create picked as canonical),
  -- it now holds moved identities but no primary. Done AFTER deleting the loser
  -- so the winner can adopt the loser's email without colliding with the (now
  -- gone) loser's person.email UNIQUE. Setting person.email fires the mirror
  -- trigger, which promotes the matching moved identity to primary.
  if v_loser_email is not null then
    update person set email = v_loser_email
      where id = p_winner and email is null;
  end if;

  -- Integration links (#284). slack_user_id and github_user_id are UNIQUE on person,
  -- so the loser's values can only be adopted after its row is gone -- same shape and
  -- same placement as the email restore above. The winner's own link always wins;
  -- github_login and github_user_id move as a PAIR (guarded on the id, the real key)
  -- so the winner can never end up with the loser's login beside its own id.
  if v_loser_slack is not null then
    update person set slack_user_id = v_loser_slack
      where id = p_winner and slack_user_id is null;
  end if;
  if v_loser_github_user_id is not null then
    update person set github_login = v_loser_github_login,
                      github_user_id = v_loser_github_user_id
      where id = p_winner and github_user_id is null;
  end if;
end $$;

grant execute on function merge_person(uuid, uuid) to service_role;
