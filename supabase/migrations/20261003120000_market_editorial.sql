-- «Анализ рынка»: ручная часть страны — то, что в эталоне (хорватский отчёт коллеги) вписано
-- руками, а не посчитано: карточки «Рынок в цифрах», хроника событий, таблица пицца-сетей,
-- корзина, «Как работают сети», оценки точек, ключевые цифры доставки, факты рынка, тексты
-- разделов и внутренние выгрузки Dodo (продажи по месяцам, заказы по каналам).
-- Одна строка на (страна, блок); содержимое — jsonb в форме блока, проверяется при импорте
-- снимка (_shared/market/editorial.ts). Нет блока — экран показывает вычисляемый вариант.
create table public.mkt_editorial (
  country text not null check (country ~ '^[A-Z]{2}$'),
  block text not null check (block ~ '^[a-z][a-z_]{1,39}$'),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (country, block)
);

alter table public.mkt_editorial enable row level security;
revoke all on public.mkt_editorial from anon, authenticated;
grant select, insert, update, delete on public.mkt_editorial to service_role;

-- Ручная часть заливается снимком и показывает свой возраст, как остальные ручные источники.
alter table public.mkt_sources drop constraint mkt_sources_feeds_check;
alter table public.mkt_sources add constraint mkt_sources_feeds_check
  check (feeds in ('locations','financials','dodo','prices','facts','editorial'));
