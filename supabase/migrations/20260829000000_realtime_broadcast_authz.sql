-- Allow authenticated clients (short-lived JWT minted by /api/realtime-token)
-- to receive our own broadcasts on private "hub:*" channels. Not a data
-- table policy: realtime.messages is Realtime's own message store, and
-- clients never send (the server uses the service key, which bypasses RLS).
--
-- Scoped on the `topic` COLUMN, not the `realtime.topic()` function: in
-- Realtime v2.124.2's private-channel READ authorization path, the
-- `realtime.topic` GUC that the function reads isn't set the way the
-- function expects (confirmed locally: `set role authenticated; select
-- realtime.topic()` returns NULL even though execute privilege is granted),
-- so `realtime.topic() like ...` always evaluates to NULL and denies. The
-- policy still runs against a synthetic row per subscribe attempt, and that
-- row's `topic` column IS populated with the channel name, so scope on it
-- directly instead.
create policy "authenticated can receive hub broadcasts"
  on realtime.messages for select
  to authenticated
  using (realtime.messages.topic like 'hub:%');
