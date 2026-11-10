-- Несколько стран у задачи, кодами (issue #1262).
--
-- Владелец 10.11.2026: «в задачах давай сделаем возможность выбора нескольких стран. также с
-- кодами, а не с полным названием страны».
--
-- Шаг 1 из двух (аддитивный): новая колонка `countries text[]` — канон; `country` остаётся и
-- зеркалит ПЕРВУЮ страну списка (код пишет то же самое в createTask/updateTask, триггер ниже
-- страхует писателей мимо кода: SQL-сид демо, ручные правки). Колонку `country` снимаем вторым
-- шагом позже, когда её перестанут читать все клиенты (правило проекта: DROP COLUMN — только
-- в два шага).
--
-- Бэкфилл: в `country` лежали и коды (ME, HU…), и полные имена («Словения», Belarus). Имена
-- приводятся к ISO-2 словарём ALIASES из `_shared/countries.ts` (копия ниже — миграция не
-- может импортировать TS), составные значения («RS, HU», «RS/HR») разбираются по
-- разделителям. Значение, которое не разобралось целиком, НЕ угадывается: `countries`
-- остаётся пустым, значение попадает в NOTICE (в `country` оно сохраняется как было).

alter table public.tasks add column if not exists countries text[] not null default '{}';

create temp table _task_country_alias (name text primary key, code text not null);
insert into _task_country_alias (name, code) values
    ('сербия', 'RS'),
    ('serbia', 'RS'),
    ('хорватия', 'HR'),
    ('croatia', 'HR'),
    ('словения', 'SI'),
    ('slovenia', 'SI'),
    ('черногория', 'ME'),
    ('montenegro', 'ME'),
    ('болгария', 'BG'),
    ('bulgaria', 'BG'),
    ('испания', 'ES'),
    ('spain', 'ES'),
    ('(испания)', 'ES'),
    ('румыния', 'RO'),
    ('romania', 'RO'),
    ('польша', 'PL'),
    ('poland', 'PL'),
    ('эстония', 'EE'),
    ('estonia', 'EE'),
    ('литва', 'LT'),
    ('lithuania', 'LT'),
    ('кипр', 'CY'),
    ('cyprus', 'CY'),
    ('венгрия', 'HU'),
    ('hungary', 'HU'),
    ('молдова', 'MD'),
    ('moldova', 'MD'),
    ('беларусь', 'BY'),
    ('belarus', 'BY'),
    ('турция', 'TR'),
    ('turkey', 'TR'),
    ('азербайджан', 'AZ'),
    ('azerbaijan', 'AZ'),
    ('армения', 'AM'),
    ('armenia', 'AM'),
    ('грузия', 'GE'),
    ('georgia', 'GE'),
    ('таджикистан', 'TJ'),
    ('tajikistan', 'TJ'),
    ('кыргызстан', 'KG'),
    ('kyrgyzstan', 'KG'),
    ('монголия', 'MN'),
    ('mongolia', 'MN'),
    ('нигерия', 'NG'),
    ('nigeria', 'NG'),
    ('мексика', 'MX'),
    ('mexico', 'MX'),
    ('бали', 'ID'),
    ('bali', 'ID'),
    ('индонезия', 'ID'),
    ('indonesia', 'ID'),
    ('россия', 'RU'),
    ('russia', 'RU'),
    ('украина', 'UA'),
    ('ukraine', 'UA'),
    ('казахстан', 'KZ'),
    ('kazakhstan', 'KZ'),
    ('узбекистан', 'UZ'),
    ('uzbekistan', 'UZ'),
    ('оаэ', 'AE'),
    ('uae', 'AE'),
    ('эмираты', 'AE'),
    ('united arab emirates', 'AE'),
    ('индия', 'IN'),
    ('india', 'IN'),
    ('швейцария', 'CH'),
    ('switzerland', 'CH');

do $$
declare
  iso constant text[] := array['AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW'];
  v record;
  tok text;
  code text;
  codes text[];
  ok boolean;
begin
  for v in
    select distinct btrim(country) as val from public.tasks
     where country is not null and btrim(country) <> '' and cardinality(countries) = 0
  loop
    codes := '{}';
    ok := true;
    -- Значение целиком: имя из словаря или ISO-код.
    select a.code into code from _task_country_alias a where a.name = lower(v.val);
    if code is null and upper(v.val) = any (iso) then code := upper(v.val); end if;
    if code is not null then
      codes := array[code];
    else
      -- Составное значение: по разделителям; хоть один токен не разобрался — не угадываем.
      for tok in select btrim(t) from regexp_split_to_table(v.val, '[,;/]') as t loop
        if tok = '' then continue; end if;
        code := null;
        select a.code into code from _task_country_alias a where a.name = lower(tok);
        if code is null and upper(tok) = any (iso) then code := upper(tok); end if;
        if code is null then ok := false; exit; end if;
        if not (code = any (codes)) then codes := codes || code; end if;
      end loop;
    end if;
    if ok and cardinality(codes) > 0 then
      update public.tasks set countries = codes
       where btrim(country) = v.val and cardinality(countries) = 0;
    else
      raise notice 'tasks.country: значение «%» не приведено к кодам — countries остаётся пустым', v.val;
    end if;
  end loop;
end $$;

drop table _task_country_alias;

alter table public.tasks add constraint tasks_countries_iso2 check (
  array_position(countries, null) is null
  and array_position(countries, '') is null
  and array_to_string(countries, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'
);

-- Фильтр «любая из стран» (`countries && array[…]`) и экран «Мои страны».
create index if not exists tasks_countries_gin on public.tasks using gin (countries);

-- Две колонки обязаны совпадать, откуда бы ни пришла запись. Код (createTask/updateTask) уже
-- пишет обе; триггер ловит остальных (демо-сид, ручной SQL):
--   · менялся список → `country` = первая страна списка;
--   · менялось только `country` → список из одного кода (если значение — ISO-код) или пустой.
create or replace function public.tasks_sync_countries() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if cardinality(new.countries) > 0 then
      new.country := new.countries[1];
    elsif new.country ~ '^[A-Z]{2}$' then
      new.countries := array[new.country];
    end if;
  elsif new.countries is distinct from old.countries then
    new.country := new.countries[1];
  elsif new.country is distinct from old.country then
    new.countries := case when new.country ~ '^[A-Z]{2}$' then array[new.country] else '{}' end;
  end if;
  return new;
end $$;

drop trigger if exists tasks_sync_countries on public.tasks;
create trigger tasks_sync_countries before insert or update of country, countries on public.tasks
  for each row execute function public.tasks_sync_countries();
