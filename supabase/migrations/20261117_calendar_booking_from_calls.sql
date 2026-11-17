alter table public.meetings add column if not exists gcal_event_id text, add column if not exists gcal_link text, add column if not exists gcal_meet text, add column if not exists gcal_error text;

-- Calendar bridge secret: never readable from the browser, even in test mode.
drop policy if exists "owner all settings" on public.settings;
create policy "owner all settings" on public.settings for all to authenticated using (is_owner() and id not in ('cron','gcal')) with check (is_owner() and id not in ('cron','gcal'));
drop policy if exists "test mode settings" on public.settings;
create policy "test mode settings" on public.settings for all to anon using (private.test_mode_on() and id not in ('test_mode','cron','gcal')) with check (private.test_mode_on() and id not in ('test_mode','cron','gcal'));

insert into public.settings (id, data) values ('gcal', jsonb_build_object('url', null, 'key', '<generated-in-db>', 'send_invites', true, 'calendar', 'maha.lasfar.2015@gmail.com'))
on conflict (id) do update set data = public.settings.data || jsonb_build_object('key', excluded.data->>'key');

-- Pull finished-call results every 5 minutes (works with or without the ElevenLabs webhook).
select cron.unschedule('sync-call-results') where exists (select 1 from cron.job where jobname='sync-call-results');
select cron.schedule('sync-call-results', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://ajwhjvoigyejcgrqjrto.supabase.co/functions/v1/call-webhook',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-key',(select data->>'key' from public.settings where id='cron')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);
