-- Allow authenticated clients (short-lived JWT minted by /api/realtime-token)
-- to receive our own broadcasts on private "hub:*" channels. Not a data
-- table policy: realtime.messages is Realtime's own message store, and
-- clients never send (the server uses the service key, which bypasses RLS).
create policy "authenticated can receive hub broadcasts"
  on realtime.messages for select
  to authenticated
  using (realtime.topic() like 'hub:%');
