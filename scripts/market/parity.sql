-- Полнота страниц «Анализа рынка»: чем наполнена каждая страна по блокам экрана (docs/market/README.md
-- §Полнота). Только чтение. Стенд: deno run -A .superpowers/sdd/stand-q.ts "$(cat scripts/market/parity.sql)";
-- прод — тот же текст через MCP execute_sql. Блок считается полным, когда у него есть свои данные:
-- ручная часть (editorial) или собранное, из чего экран строит вычисленный вариант.
with c as (select distinct country from public.mkt_chains),
ed as (select country, array_agg(block) b from public.mkt_editorial group by 1),
loc as (
  select country, count(*) n, count(*) filter (where opened is not null) dated,
    count(*) filter (where opened >= '2021') dated21
  from public.mkt_locations where status <> 'planned' group by 1
),
fin as (
  select co.country, count(*) filter (where f.revenue_eur is not null) n,
    count(distinct co.id) filter (where f.revenue_eur is not null) companies,
    count(distinct co.id) filter (where f.revenue_eur is not null and ch.segment = 'pizza') pizza_companies
  from public.mkt_financials f join public.mkt_companies co on co.id = f.company_id
  left join public.mkt_chains ch on ch.country = co.country and ch.key = co.chain_key group by 1
),
dodo as (
  select country, count(*) filter (where revenue_eur is not null) months,
    count(*) filter (where orders - '_days' <> '{}'::jsonb) order_months
  from public.mkt_dodo_monthly group by 1
),
pr as (select country, count(*) n, count(distinct chain_key) chains from public.mkt_prices group by 1),
fa as (
  select country, count(*) filter (where topic = 'delivery') delivery, count(*) filter (where topic = 'market') market
  from public.mkt_facts group by 1
),
rt as (select country, count(*) n from public.mkt_ratings group by 1)
select c.country,
  coalesce(loc.n, 0)::int as "точек",
  coalesce(round(100.0 * loc.dated / nullif(loc.n, 0)), 0)::int as "% с датой",
  coalesce(loc.dated21, 0)::int as "открытий с 2021",
  'summary' = any(ed.b) as "сводка: ручная",
  'events' = any(ed.b) as "события: ручные",
  'growth' = any(ed.b) as "динамика: ручная",
  coalesce(fin.companies, 0)::int as "юрлиц с выручкой",
  coalesce(fin.pizza_companies, 0)::int as "пицца-юрлиц с выручкой",
  'pizza_table' = any(ed.b) as "таблица пицц: ручная",
  coalesce(dodo.months, 0)::int as "месяцев выручки Dodo",
  coalesce(dodo.order_months, 0)::int as "месяцев заказов Dodo",
  'dodo_ops' = any(ed.b) as "операции Dodo",
  coalesce(pr.chains, 0)::int as "сетей с ценами",
  'basket' = any(ed.b) as "корзина",
  'ops_model' = any(ed.b) as "как работают сети",
  'ratings' = any(ed.b) or coalesce(rt.n, 0) > 0 as "оценки",
  'delivery_platforms' = any(ed.b) or coalesce(fa.delivery, 0) > 0 as "доставка",
  'market_facts' = any(ed.b) or coalesce(fa.market, 0) > 0 as "факты рынка"
from c left join ed using (country) left join loc using (country) left join fin using (country)
  left join dodo using (country) left join pr using (country) left join fa using (country) left join rt using (country)
order by c.country;
