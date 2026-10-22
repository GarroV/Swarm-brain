-- Ключ к нейронке у пространства и список мастер-админов: этап 1 задачи #233
-- (docs/decisions/2026-10-14-workspace-settings-and-keys.md). Миграция только создаёт новые
-- объекты и поведение для команды не меняет: пока в workspace_secrets нет строк, везде ключ сервера.
--
-- workspace_secrets — ключ пространства В ЗАШИФРОВАННОМ ВИДЕ (AES-256-GCM, _shared/secret-box.ts;
-- ключ шифрования — секрет сервера WORKSPACE_SECRETS_KEY, в базу не попадает). В AAD шифротекста
-- входит `<group_id>:<kind>`, поэтому строка, перенесённая в другое пространство, не расшифруется.
-- Наружу ключ не отдаётся никогда: только last4 и дата.
-- master_admins — мастер-админы (видят и настраивают все пространства). Владелец засеян.
--
-- Обратимость: откат — `drop table public.workspace_secrets, public.master_admins;` после того,
-- как код перестанет их читать.

create table if not exists public.workspace_secrets (
  group_id   text not null references public.workspaces(id),
  kind       text not null check (kind in ('openai')),
  ciphertext text not null,
  iv         text not null,
  last4      text not null,
  set_by     bigint not null,
  set_at     timestamptz not null default now(),
  last_error    text,
  last_error_at timestamptz,
  primary key (group_id, kind)
);

comment on table public.workspace_secrets is
  'Секреты пространств в зашифрованном виде (AES-256-GCM, AAD = group_id:kind). Читает только service_role через _shared/workspace-keys.ts; ключ наружу не отдаётся. #233.';
comment on column public.workspace_secrets.last4 is
  'Последние 4 символа ключа — единственное, что показывается человеку.';

comment on column public.workspace_secrets.last_error is
  'Последний отказ OpenAI этому ключу (rejected = 401); очищается новым ключом. Показ — только в статусе ключа.';

create table if not exists public.master_admins (
  telegram_id bigint primary key,
  added_by    bigint,
  created_at  timestamptz not null default now()
);

comment on table public.master_admins is
  'Мастер-админы: доступ ко всем пространствам. Константа SUPERADMIN_TELEGRAM_ID в коде остаётся запасной. #233.';

insert into public.master_admins (telegram_id, added_by)
values (744230399, 744230399)
on conflict do nothing;

-- Data API: явный грант service_role (supabase/migrations/_template_new_table.sql).
grant select, insert, update, delete on public.workspace_secrets to service_role;
grant select, insert, update, delete on public.master_admins to service_role;

-- Внешний замок: RLS без политик. Грант на PUBLIC наследуется в anon, поэтому снимаем и с него.
alter table public.workspace_secrets enable row level security;
alter table public.master_admins enable row level security;
revoke all on public.workspace_secrets from public, anon, authenticated;
revoke all on public.master_admins from public, anon, authenticated;
