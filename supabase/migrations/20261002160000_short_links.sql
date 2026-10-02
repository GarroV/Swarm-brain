-- Сокращатель ссылок («Полезности» → «Короткие ссылки»): короткий код → длинный адрес.
-- Переход по `/s/<code>` обслуживает Pages Function веба через публичный маршрут swarm-api,
-- создают и видят ссылки только вошедшие участники (свои — по owner_id).
-- Ничего не удаляется физически: «убрать» = archived_at (правило проекта, архивация вместо удаления).
create table if not exists public.short_links (
  code            text primary key check (code ~ '^[A-Za-z0-9]{4,16}$'),
  url             text not null check (char_length(url) between 8 and 2048),
  owner_id        bigint not null,
  group_id        text,
  clicks          integer not null default 0,
  last_clicked_at timestamptz,
  created_at      timestamptz not null default now(),
  archived_at     timestamptz
);

comment on table public.short_links is
  'Короткие ссылки: /s/<code> → url. Пишет и читает swarm-api (service_role); архивация вместо удаления.';

create index if not exists short_links_owner_idx
  on public.short_links (owner_id, created_at desc)
  where archived_at is null;

-- Внешний замок, как у всех таблиц public: RLS без политик, anon/authenticated без прав.
alter table public.short_links enable row level security;
revoke all on public.short_links from anon, authenticated;

-- Переход: один запрос и находит адрес, и считает клик (без гонки «прочитал → прибавил»).
-- SECURITY INVOKER: функция работает с правами вызывающего, а вызывает её только service_role.
create or replace function public.short_link_hit(p_code text)
returns text
language sql
security invoker
set search_path = public
as $$
  update public.short_links
     set clicks = clicks + 1,
         last_clicked_at = now()
   where code = p_code
     and archived_at is null
  returning url;
$$;

-- Грант на PUBLIC наследуют anon/authenticated — снимаем именно с PUBLIC (урок GHSA-vxrp-599j-46hv).
revoke execute on function public.short_link_hit(text) from public, anon, authenticated;
grant execute on function public.short_link_hit(text) to service_role;
