-- Allow authenticated clients (short-lived JWT minted by /api/realtime-token)
-- to receive our own broadcasts on private "hub:*" channels. Not a data
-- table policy: realtime.messages is Realtime's own message store, and
-- clients never send (the server uses the service key, which bypasses RLS).
--
-- Realtime's private-channel READ authorization runs this SELECT policy, in a
-- rolled-back transaction, against a synthetic row whose `topic` column holds
-- the channel name. Scoping on the `topic` column (rather than the
-- `realtime.topic()` helper) keeps the check independent of that transaction's
-- GUC setup and is verified to authorize delivery. Confirmed by a controlled
-- toggle: an authenticated subscriber receives a server-side private broadcast
-- with this policy in place, and is denied when the join authorizes as anon.
create policy "authenticated can receive hub broadcasts"
  on realtime.messages for select
  to authenticated
  using (realtime.messages.topic like 'hub:%');
