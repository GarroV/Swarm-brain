-- Only an explicit failed capture unmutes the ordinary recording offer for participants.
-- Null means an older bot with no health observation; existing arbitration/leases stay intact.
alter table public.meetings add column if not exists agent_last_audio_healthy boolean;
comment on column public.meetings.agent_last_audio_healthy is
  'Latest observed bot audio health; false after sustained silence with people, true after sound returns. Not a claim/lease decision.';
