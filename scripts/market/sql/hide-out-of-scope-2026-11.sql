-- #1113, решение 10.11.2026 (docs/decisions/2026-11-10-market-fastfood-only.md): скрыть найденные раньше сети
-- вне объёма «Анализа рынка» (не брендовый фастфуд). НЕ миграция: применяет координатор после миграции
-- `20261113120000_market_chains_hidden_at.sql`. Ничего не удаляет: ставит mkt_chains.hidden_at.
--
-- Как пользоваться:
--   1. Выполнить блок «ПРЕДПРОСМОТР» (SELECT) — число сетей и точек по странам, сверить с решением.
--   2. Выполнить блок «ПРИМЕНЕНИЕ» (UPDATE) — идемпотентен: уже скрытые не трогает.
--   3. Откат точечно: update mkt_chains set hidden_at = null where country = '..' and key = '..'.
--
-- Сеть скрывается, только если выполнены ВСЕ условия:
--   * страна из списка автопоиска Overture (AM AZ BY CY ES GE HU LT MD PL): у остальных стран карта из OSM;
--   * машинное происхождение: нет origin/operator/first_entry/notes/hist (ручных данных нет);
--   * все её точки — из машинных источников (osm, overture), ни одной внесённой руками, снимком или Dodo;
--   * не записана в конфиге страны (config_chains) и не входит в сети, которые автопоиск находит сейчас
--     (discovered_now): их считает `overture.discover` по правилам решения — только фастфуд, только с брендом,
--     от 3 точек. Категории Overture в базе не хранятся, поэтому «фастфуд» нельзя вывести из segment
--     (сеть segment=other с категорией fast_food_restaurant, напр. Taco Bell, остаётся);
--   * нет ссылок: юрлица, цены, источники, упоминание ключа в editorial.
-- Списки config_chains и discovered_now — снимок на 13.11.2026 (конфиги стран и Overture, последний релиз):
-- перед применением на другой день пересчитать (config: `chains[].key` в scripts/market/countries/*.ts;
-- discovered_now: `overture.collect(<конфиг страны>)` → `chains[].key`, нужен `deno run -A --config deno.json`).
-- McCafé (`mccafe`) остаётся отдельной сетью (решение 07.11.2026) — автопоиск находит её сам и в списке есть.

-- ── ПРЕДПРОСМОТР ───────────────────────────────────────────────────────────
with config_chains(country, key) as (
  values
    ('HR','dodo'), ('HR','dominos'), ('HR','pizzahut'), ('HR','pizzaexpress_hr'), ('HR','tuttobene'), ('HR','mcdonalds'),
    ('HR','burgerking'), ('HR','submarine-burger'), ('HR','kfc'), ('HR','batak-grill'), ('HR','mlinar'), ('HR','pan-pek'),
    ('HR','pekara-dubravica'), ('HR','leggiero'), ('HR','gyotaku'), ('HR','koykan'), ('HR','purple-monkey'), ('HR','umami'),
    ('HR','wok-me'), ('HR','good-food'), ('HR','biberon'), ('HR','foodie'), ('HR','pasta-fasta'), ('RO','dodo'),
    ('RO','dominos'), ('RO','pizzahut'), ('RO','jerrys'), ('RO','mcdonalds'), ('RO','burgerking'), ('RO','kfc'),
    ('RO','subway'), ('RO','spartan'), ('RO','saladbox'), ('EE','dodo'), ('EE','dominos'), ('EE','peetri'),
    ('EE','kotipizza'), ('EE','mcdonalds'), ('EE','hesburger'), ('EE','burgerking'), ('EE','kfc'), ('EE','subway'),
    ('RS','dodo'), ('RS','pizzahut'), ('RS','caribic'), ('RS','mcdonalds'), ('RS','burgerking'), ('RS','kfc'),
    ('RS','walter'), ('RS','tacobell'), ('RS','burrito-madre'), ('RS','starbucks'), ('RS','skroz-dobra-pekara'), ('RS','hleb-i-kifle'),
    ('RS','zlatni-klas'), ('SI','dodo'), ('SI','mcdonalds'), ('SI','burgerking'), ('SI','hood-burger'), ('SI','hot-horse'),
    ('SI','kfc'), ('SI','subway'), ('SI','chutys'), ('SI','pecjak'), ('SI','zito'), ('SI','brumat'),
    ('SI','mlinar'), ('ME','dodo'), ('ME','pizzahut'), ('ME','burgerking'), ('ME','walter'), ('ME','caffeine'),
    ('ME','pekara-montenegro'), ('ME','pekara-sicilia'), ('BG','dodo'), ('BG','dominos'), ('BG','papajohns'), ('BG','pizzalab'),
    ('BG','mcdonalds'), ('BG','burgerking'), ('BG','hesburger'), ('BG','skapto'), ('BG','kfc'), ('BG','subway'),
    ('BG','go-grill'), ('BG','happy'), ('BG','aladin'), ('BG','starbucks'), ('BG','costa'), ('BG','fornetti'),
    ('BG','sofiyska-banitsa'), ('BG','kings-bakery'), ('BY','dodo'), ('BY','dominos'), ('BY','pizzahut'), ('BY','mcdonalds'),
    ('BY','burgerking'), ('BY','kfc'), ('BY','subway'), ('BY','starbucks'), ('BY','costa'), ('BY','terra-pizza'),
    ('CY','dodo'), ('CY','dominos'), ('CY','pizzahut'), ('CY','mcdonalds'), ('CY','burgerking'), ('CY','kfc'),
    ('CY','subway'), ('CY','starbucks'), ('CY','costa'), ('CY','coffee-island'), ('ES','dodo'), ('ES','dominos'),
    ('ES','pizzahut'), ('ES','mcdonalds'), ('ES','burgerking'), ('ES','kfc'), ('ES','subway'), ('ES','starbucks'),
    ('ES','costa'), ('ES','llaollao'), ('ES','telepizza'), ('ES','rodilla'), ('ES','pans-company'), ('ES','100-montaditos-portugal'),
    ('ES','goiko'), ('ES','pomodoro-pizza-pasta-burritos'), ('HU','dodo'), ('HU','dominos'), ('HU','pizzahut'), ('HU','mcdonalds'),
    ('HU','burgerking'), ('HU','kfc'), ('HU','subway'), ('HU','starbucks'), ('HU','costa'), ('LT','dodo'),
    ('LT','dominos'), ('LT','pizzahut'), ('LT','mcdonalds'), ('LT','burgerking'), ('LT','kfc'), ('LT','subway'),
    ('LT','starbucks'), ('LT','costa'), ('LT','cili-pizza-lietuva'), ('MD','dodo'), ('MD','dominos'), ('MD','pizzahut'),
    ('MD','mcdonalds'), ('MD','burgerking'), ('MD','kfc'), ('MD','subway'), ('MD','starbucks'), ('MD','costa'),
    ('MD','andy-s'), ('PL','dodo'), ('PL','dominos'), ('PL','pizzahut'), ('PL','mcdonalds'), ('PL','burgerking'),
    ('PL','kfc'), ('PL','subway'), ('PL','starbucks'), ('PL','costa'), ('PL','da-grasso'), ('PL','pasibus'),
    ('PL','gruby-benek'), ('PL','kebab-king'), ('GE','dodo'), ('GE','dominos'), ('GE','pizzahut'), ('GE','mcdonalds'),
    ('GE','burgerking'), ('GE','kfc'), ('GE','subway'), ('GE','starbucks'), ('GE','costa'), ('GE','wendys'),
    ('GE','dunkin'), ('GE','papajohns'), ('AM','dodo'), ('AM','dominos'), ('AM','pizzahut'), ('AM','mcdonalds'),
    ('AM','burgerking'), ('AM','kfc'), ('AM','subway'), ('AM','starbucks'), ('AM','costa'), ('AM','papajohns'),
    ('AM','tashir'), ('AZ','dodo'), ('AZ','dominos'), ('AZ','pizzahut'), ('AZ','mcdonalds'), ('AZ','burgerking'),
    ('AZ','kfc'), ('AZ','subway'), ('AZ','starbucks'), ('AZ','costa'), ('AZ','papajohns'), ('AZ','dunkin'),
    ('AZ','wendys'), ('KG','dodo'), ('KG','kfc'), ('KG','papajohns'), ('KG','imperiya-pizzy'), ('KG','wok-lagman'),
    ('KG','begemot'), ('KG','mubarak'), ('KG','navat'), ('KG','coffee-like'), ('TJ','dodo'), ('TJ','kfc'),
    ('TJ','tajburger'), ('TJ','sfc'), ('TJ','shokoladnitsa')

), discovered_now(country, key) as (
  values
    ('AM','karas-armenia'), ('AM','mr-gyros'), ('AZ','bir-iki'), ('AZ','pizza-bruno'), ('AZ','pizza-house'), ('AZ','pizza-mizza'),
    ('AZ','shaurma'), ('BY','chain-пиццалисицца'), ('BY','chain-пиццатемпо'), ('BY','doner-king'), ('BY','grill-kebab'), ('BY','mccafe'),
    ('BY','nravizza'), ('BY','papa-doner-kebab-pizza'), ('BY','pizza-smile'), ('CY','alfa-pizza'), ('CY','papa-john-s-pizza'), ('CY','pizza-mia'),
    ('CY','pizza-mine'), ('CY','taco-bell'), ('CY','toronto-pizza'), ('ES','aires-burger-bar'), ('ES','autogrill'), ('ES','bar-paraiso-pizzeria-arepera'),
    ('ES','big-twins-smash-burger-en-alicante'), ('ES','bodega-el-picadero'), ('ES','burger-house'), ('ES','burger-jazz'), ('ES','can-pizza'), ('ES','carpi-pizza'),
    ('ES','ciaopizza-es'), ('ES','circo-burger'), ('ES','cotton-grill'), ('ES','da-capo-pizza'), ('ES','darilo-s-pizza'), ('ES','del-poble-pizzeria'),
    ('ES','dogos'), ('ES','dolce-vita-pizzeries'), ('ES','el-pibe'), ('ES','express-vip-pizzas'), ('ES','fanneli-s-burgers'), ('ES','galipizza'),
    ('ES','gottan-grill'), ('ES','grill-corner-restaurant-brasa'), ('ES','grill-house'), ('ES','grillmeister'), ('ES','hebe-gyros'), ('ES','i-love-pizza'),
    ('ES','junk-burger'), ('ES','kebab-nuevo-gijon'), ('ES','kilometros-de-pizza'), ('ES','king-doner-kebab'), ('ES','king-kebab'), ('ES','la-burger-vasca'),
    ('ES','la-pala-pizzeria-ristorante'), ('ES','la-pepita-burger-bar'), ('ES','la-pizzeria'), ('ES','la-pizzeta'), ('ES','las-fritas'), ('ES','leyenda-burger'),
    ('ES','machaka-burger'), ('ES','mama-pizza'), ('ES','marruzella-fast-food'), ('ES','masakali-pizza'), ('ES','masamadre-pizza'), ('ES','maxi-pizza'),
    ('ES','mccafe'), ('ES','mr-pizza'), ('ES','mucho-que-pizza-elda'), ('ES','nap-neapolitan-authentic-pizza'), ('ES','new-york-burger'), ('ES','novapizza-ibi'),
    ('ES','papa-john-s'), ('ES','papa-john-s-pizza'), ('ES','paparazzi-pizza-e-pasta'), ('ES','papizza'), ('ES','parking-pizza'), ('ES','pizza-a-punt'),
    ('ES','pizza-city'), ('ES','pizza-express'), ('ES','pizza-house'), ('ES','pizza-loca'), ('ES','pizza-lopez-almeria'), ('ES','pizza-mania'),
    ('ES','pizza-napoli'), ('ES','pizza-pazza'), ('ES','pizza-royers'), ('ES','pizza-stick'), ('ES','pizza-xxl-cabo-roig'), ('ES','pizza-y-mas'),
    ('ES','pizzanatura'), ('ES','pizzart'), ('ES','pizzeria'), ('ES','pizzeria-1900'), ('ES','pizzeria-carlos-sevilla'), ('ES','pizzeria-chao-chao'),
    ('ES','pizzeria-el-barrio-benalmadena'), ('ES','pizzeria-francesco'), ('ES','pizzeria-la-competencia-aviles'), ('ES','pizzeria-la-rustica'), ('ES','pizzeria-mayor'), ('ES','pizzeria-michelangelo'),
    ('ES','pizzeria-milano'), ('ES','pizzeria-peccato'), ('ES','pizzeria-popeye'), ('ES','pizzeria-regina'), ('ES','pizzeria-san-luis'), ('ES','pizzeria-tivoli'),
    ('ES','pizzerias-carlos'), ('ES','pizzon-pizza'), ('ES','popeyes-louisiana-kitchen'), ('ES','porta-pizza-gran-canaria'), ('ES','presto-pizza'), ('ES','restaurante-picasso'),
    ('ES','rosario-s-burgers'), ('ES','royal-pizza'), ('ES','sabores-express'), ('ES','sancho-casual-burger'), ('ES','sandwichez'), ('ES','solopizza-madrid'),
    ('ES','starkebab'), ('ES','steakburger'), ('ES','sultan-kebab'), ('ES','taco-bell'), ('ES','taxi-angus-american-burger'), ('ES','tepuy-burger'),
    ('ES','the-good-burger'), ('ES','the-mexican-bar-grill'), ('ES','the-stone-grill'), ('ES','tonipizzeria'), ('ES','toro-burger-lounge'), ('ES','tropicalissima'),
    ('GE','burger-bar'), ('HU','belfrit'), ('HU','california-burger-dob-utca'), ('HU','deep-burger'), ('HU','doner-king-belarus'), ('HU','duna-doner-debrecen'),
    ('HU','jack-s-burger'), ('HU','mccafe'), ('HU','nagyi-palacsintazoja-granny-s-pancak'), ('HU','pasa-kebab-szekesfehervar'), ('HU','pizza-express'), ('HU','pizza-firenze'),
    ('HU','pizza-forte'), ('HU','pizza-karavan-salgotarjan'), ('HU','pizza-me'), ('HU','pizza-monkey'), ('HU','pizza-napoli-felsozsolca'), ('HU','pizza-plus'),
    ('HU','punto-gelato-cukraszda-es-pizzeria'), ('HU','reinpold-s-kolbice'), ('HU','the-burger-project'), ('HU','trofea-grill-etterem-ujbuda'), ('HU','zing-burger-co'), ('LT','arena-pizza'),
    ('LT','charlie-pizza'), ('LT','fokus-pizza'), ('LT','grill-london'), ('LT','hesburger'), ('LT','jammi'), ('LT','kebab-inn'),
    ('LT','mccafe'), ('LT','momo-grill'), ('LT','nr1-pica'), ('LT','oregano-pica'), ('LT','pizza-express'), ('LT','pizza-siracusa'),
    ('LT','troliu-pica'), ('LT','uno-pica-anyksciai'), ('LT','wraperia-suppa-kebs'), ('MD','corso-pizza'), ('MD','don-cezar-pizza-grill'), ('MD','pizza-mania'),
    ('MD','starkebab'), ('MD','torro-burgers'), ('MD','wurst'), ('PL','adnan-kebab-jaros-aw'), ('PL','alanya-kebab'), ('PL','am-am-kebab'),
    ('PL','am-am-kebab-aquafun-legnica'), ('PL','american-pizza-slice-przec-aw'), ('PL','antalya-kebab-tywyn'), ('PL','arif-kebab-restaurant'), ('PL','atmosfera-pizzeria-sochaczew'), ('PL','azan-kebab-i-awa'),
    ('PL','azhir-kebab'), ('PL','bafra-kebab'), ('PL','bd-king-kebab-kossaka'), ('PL','bd-star-kebab-sztum'), ('PL','berlin-doner-kebap'), ('PL','bobby-burger'),
    ('PL','burger-house'), ('PL','bursa-kebab-gorzno'), ('PL','byczek-kebab-skalbmierz'), ('PL','canvas-kebab'), ('PL','carat-kebab'), ('PL','casa-della-pizza'),
    ('PL','century-kebab-grill-krosno-odrzanski'), ('PL','chicago-s-pizza'), ('PL','coffee-pizza-giona-bochnia'), ('PL','cool-pizza-leszno'), ('PL','darul-kebab-ryki'), ('PL','delta-kebab'),
    ('PL','dhaka-kebab'), ('PL','doner-king-belarus'), ('PL','dostana-kebab'), ('PL','efes-kebab-targowek'), ('PL','ekushe-kebab'), ('PL','enjoy-doner-kebab-miejska-gorka'),
    ('PL','expert-kebab'), ('PL','express-pizza'), ('PL','express-pizza-wroc-aw'), ('PL','frasses'), ('PL','frentzza-pizza-friends'), ('PL','friends-kebab-zaspa'),
    ('PL','frytkibelgijskie-pl'), ('PL','g-odna-ma-pa-pizza-chill'), ('PL','garden-kebab-rudnik-nad-sanem'), ('PL','git-burger'), ('PL','goracy-trojkat-pizza-grajewo'), ('PL','great-kebab-pruszcz-gdanski'),
    ('PL','hasan-kebab'), ('PL','hot-chilli-kebab-olsztyn'), ('PL','i-love-pizza'), ('PL','ilman-kebab'), ('PL','insaf-kebab'), ('PL','ishan-kebab'),
    ('PL','istanbul-doner-kebap'), ('PL','istanbul-kebab'), ('PL','jamuna-kebab'), ('PL','kebab-center-zwolen'), ('PL','kebab-expert-raciborz'), ('PL','kebab-fiery'),
    ('PL','kebab-gold'), ('PL','kebab-inn'), ('PL','kebab-inn-raciborz'), ('PL','kebab-magic-pe-czyce'), ('PL','kebab-mark'), ('PL','kebab-nook'),
    ('PL','kebab-orient-zmigrod'), ('PL','kebab-point-srem'), ('PL','kebab-super-king'), ('PL','kebab-z-ogrodka-bierun'), ('PL','king-kebab'), ('PL','krowa-burger'),
    ('PL','krowa-burger-sarbinowo'), ('PL','krowa-mac-burgers-jastrzebie'), ('PL','kurczak-z-rozna-na-dolnej'), ('PL','m-doner'), ('PL','magic-pizzeria-es-etterem'), ('PL','mast-kebab-w-oc-awek'),
    ('PL','max'), ('PL','max-burgers'), ('PL','max-kebab'), ('PL','maxi-pizza'), ('PL','maxi-pizza-sosnowiec'), ('PL','mccafe'),
    ('PL','mim-kebab'), ('PL','mir-kebab'), ('PL','monsi-kebab-gorzkowice'), ('PL','moon-kebab-trzebnica'), ('PL','nehar-kebab-24h-staro-eka'), ('PL','new-york-pizza-department'),
    ('PL','noor-kebab'), ('PL','papa-johns-pizza'), ('PL','party-pizza'), ('PL','pepe-pizza'), ('PL','piekarnia-pizzy-krakow'), ('PL','pirat-pizza-wolsztyn'),
    ('PL','pizza'), ('PL','pizza-66'), ('PL','pizza-express'), ('PL','pizza-factory-inc'), ('PL','pizza-house'), ('PL','pizza-na-wypasie'),
    ('PL','pizza-station'), ('PL','pizzatopia'), ('PL','pizzeria'), ('PL','pizzeria-105'), ('PL','pizzeria-aniela-nowa-sarzyna'), ('PL','pizzeria-avanti'),
    ('PL','pizzeria-fantazja'), ('PL','pizzeria-fenix-budva'), ('PL','pizzeria-gang'), ('PL','pizzeria-grande'), ('PL','pizzeria-italia'), ('PL','pizzeria-koliber-w-baranowie-sandomi'),
    ('PL','pizzeria-milano'), ('PL','pizzeria-muzyczna'), ('PL','pizzeria-nocna-odz-jedzenie-z-dostaw'), ('PL','pizzeria-palermo'), ('PL','pizzeria-peperoni'), ('PL','pizzeria-peperoni-srodmiescie'),
    ('PL','pizzeria-primavera'), ('PL','pizzeria-raptorius'), ('PL','pizzeria-restauracja-k2-radziejow'), ('PL','pizzeria-ricco'), ('PL','pizzeria-roberto'), ('PL','pizzeria-romano'),
    ('PL','pizzeria-trattoria-presto-aleksandro'), ('PL','pizzeria-u-batmana-w-radzionkowie'), ('PL','pizzeria-verona-krapkowice'), ('PL','prego-pizza'), ('PL','probe-burger'), ('PL','punto-pizza'),
    ('PL','pyszny-kebab-bia-a-podlaska'), ('PL','rajshahi-kebab-zbaszynek'), ('PL','raju-kebab-rynek-5-kozle'), ('PL','red-chili-kebab-grill-pizza'), ('PL','robiul-kebab-grill'), ('PL','rollo-kebab'),
    ('PL','rose-kebab-ujscie'), ('PL','royal-kebab-koluszki'), ('PL','saba-kebab-tczew'), ('PL','sakim-kebab'), ('PL','salad-story'), ('PL','salsiccia-pizzeria-napoletana'),
    ('PL','sbarro'), ('PL','selfie-spicy-kebab'), ('PL','sevi-kebab'), ('PL','shaik-kebab'), ('PL','sivas-kebab'), ('PL','smak-kebab-lomza'),
    ('PL','solo-pizza'), ('PL','spicy-kebab-grill'), ('PL','spoko-kebab-brzeg-dolny'), ('PL','star-kebap-pizza'), ('PL','starkebab'), ('PL','stodola'),
    ('PL','sultan-kebab'), ('PL','surfburger'), ('PL','szamot-pizza'), ('PL','t-pizza'), ('PL','telepizza'), ('PL','the-brand-kebab-and-grill-czarnkow'),
    ('PL','the-fry'), ('PL','the-king-kebab'), ('PL','the-pizza'), ('PL','u-szwagra'), ('PL','zahir-kebab'), ('PL','zamil-kebab'),
    ('PL','zarin-kebab-warszawa')
), out_of_scope as (
  select c.country, c.key
  from public.mkt_chains c
  where c.country in ('AM', 'AZ', 'BY', 'CY', 'ES', 'GE', 'HU', 'LT', 'MD', 'PL')
    and c.origin is null and c.operator is null and c.first_entry is null and c.notes is null and c.hist is null
    and not exists (select 1 from config_chains k where k.country = c.country and k.key = c.key)
    and not exists (select 1 from discovered_now k where k.country = c.country and k.key = c.key)
    and exists (select 1 from public.mkt_locations l where l.country = c.country and l.chain_key = c.key)
    and not exists (
      select 1 from public.mkt_locations l
      where l.country = c.country and l.chain_key = c.key and l.source_kind not in ('osm', 'overture')
    )
    and not exists (select 1 from public.mkt_companies x where x.country = c.country and x.chain_key = c.key)
    and not exists (select 1 from public.mkt_prices x where x.country = c.country and x.chain_key = c.key)
    and not exists (select 1 from public.mkt_sources x where x.country = c.country and x.chain_key = c.key)
    and not exists (
      select 1 from public.mkt_editorial e
      where e.country = c.country and e.payload::text like '%"' || c.key || '"%'
    )
    and c.hidden_at is null
)
select o.country,
       count(distinct o.key) as chains,
       count(l.id) as locations
from out_of_scope o
left join public.mkt_locations l on l.country = o.country and l.chain_key = o.key
group by rollup (o.country)
order by o.country;

-- Проверить глазами: сети фастфуд-сегмента, которые попадут под скрытие (дубли брендов под другим ключом и
-- сети без бренда — решение владельца про «без бренда не заводим»); лишнюю — внести в discovered_now.
select o.country, count(*) as chains, sum((select count(*) from public.mkt_locations l where l.country = o.country and l.chain_key = o.key)) as locations,
       string_agg(o.key, ', ') as keys
from out_of_scope o join public.mkt_chains c on c.country = o.country and c.key = o.key
where c.segment in ('pizza', 'burger', 'chicken', 'sandwich', 'grill')
group by 1 order by 1;

-- ── ПРИМЕНЕНИЕ ─────────────────────────────────────────────────────────────
-- Тот же CTE (блоки выполняются по отдельности). Закомментирован, чтобы файл целиком нельзя было прогнать
-- случайно: снять `-- ` и выполнить после проверки предпросмотра.
--
-- with config_chains(country, key) as (
--   values
--     ('HR','dodo'), ('HR','dominos'), ('HR','pizzahut'), ('HR','pizzaexpress_hr'), ('HR','tuttobene'), ('HR','mcdonalds'),
--     ('HR','burgerking'), ('HR','submarine-burger'), ('HR','kfc'), ('HR','batak-grill'), ('HR','mlinar'), ('HR','pan-pek'),
--     ('HR','pekara-dubravica'), ('HR','leggiero'), ('HR','gyotaku'), ('HR','koykan'), ('HR','purple-monkey'), ('HR','umami'),
--     ('HR','wok-me'), ('HR','good-food'), ('HR','biberon'), ('HR','foodie'), ('HR','pasta-fasta'), ('RO','dodo'),
--     ('RO','dominos'), ('RO','pizzahut'), ('RO','jerrys'), ('RO','mcdonalds'), ('RO','burgerking'), ('RO','kfc'),
--     ('RO','subway'), ('RO','spartan'), ('RO','saladbox'), ('EE','dodo'), ('EE','dominos'), ('EE','peetri'),
--     ('EE','kotipizza'), ('EE','mcdonalds'), ('EE','hesburger'), ('EE','burgerking'), ('EE','kfc'), ('EE','subway'),
--     ('RS','dodo'), ('RS','pizzahut'), ('RS','caribic'), ('RS','mcdonalds'), ('RS','burgerking'), ('RS','kfc'),
--     ('RS','walter'), ('RS','tacobell'), ('RS','burrito-madre'), ('RS','starbucks'), ('RS','skroz-dobra-pekara'), ('RS','hleb-i-kifle'),
--     ('RS','zlatni-klas'), ('SI','dodo'), ('SI','mcdonalds'), ('SI','burgerking'), ('SI','hood-burger'), ('SI','hot-horse'),
--     ('SI','kfc'), ('SI','subway'), ('SI','chutys'), ('SI','pecjak'), ('SI','zito'), ('SI','brumat'),
--     ('SI','mlinar'), ('ME','dodo'), ('ME','pizzahut'), ('ME','burgerking'), ('ME','walter'), ('ME','caffeine'),
--     ('ME','pekara-montenegro'), ('ME','pekara-sicilia'), ('BG','dodo'), ('BG','dominos'), ('BG','papajohns'), ('BG','pizzalab'),
--     ('BG','mcdonalds'), ('BG','burgerking'), ('BG','hesburger'), ('BG','skapto'), ('BG','kfc'), ('BG','subway'),
--     ('BG','go-grill'), ('BG','happy'), ('BG','aladin'), ('BG','starbucks'), ('BG','costa'), ('BG','fornetti'),
--     ('BG','sofiyska-banitsa'), ('BG','kings-bakery'), ('BY','dodo'), ('BY','dominos'), ('BY','pizzahut'), ('BY','mcdonalds'),
--     ('BY','burgerking'), ('BY','kfc'), ('BY','subway'), ('BY','starbucks'), ('BY','costa'), ('BY','terra-pizza'),
--     ('CY','dodo'), ('CY','dominos'), ('CY','pizzahut'), ('CY','mcdonalds'), ('CY','burgerking'), ('CY','kfc'),
--     ('CY','subway'), ('CY','starbucks'), ('CY','costa'), ('CY','coffee-island'), ('ES','dodo'), ('ES','dominos'),
--     ('ES','pizzahut'), ('ES','mcdonalds'), ('ES','burgerking'), ('ES','kfc'), ('ES','subway'), ('ES','starbucks'),
--     ('ES','costa'), ('ES','llaollao'), ('ES','telepizza'), ('ES','rodilla'), ('ES','pans-company'), ('ES','100-montaditos-portugal'),
--     ('ES','goiko'), ('ES','pomodoro-pizza-pasta-burritos'), ('HU','dodo'), ('HU','dominos'), ('HU','pizzahut'), ('HU','mcdonalds'),
--     ('HU','burgerking'), ('HU','kfc'), ('HU','subway'), ('HU','starbucks'), ('HU','costa'), ('LT','dodo'),
--     ('LT','dominos'), ('LT','pizzahut'), ('LT','mcdonalds'), ('LT','burgerking'), ('LT','kfc'), ('LT','subway'),
--     ('LT','starbucks'), ('LT','costa'), ('LT','cili-pizza-lietuva'), ('MD','dodo'), ('MD','dominos'), ('MD','pizzahut'),
--     ('MD','mcdonalds'), ('MD','burgerking'), ('MD','kfc'), ('MD','subway'), ('MD','starbucks'), ('MD','costa'),
--     ('MD','andy-s'), ('PL','dodo'), ('PL','dominos'), ('PL','pizzahut'), ('PL','mcdonalds'), ('PL','burgerking'),
--     ('PL','kfc'), ('PL','subway'), ('PL','starbucks'), ('PL','costa'), ('PL','da-grasso'), ('PL','pasibus'),
--     ('PL','gruby-benek'), ('PL','kebab-king'), ('GE','dodo'), ('GE','dominos'), ('GE','pizzahut'), ('GE','mcdonalds'),
--     ('GE','burgerking'), ('GE','kfc'), ('GE','subway'), ('GE','starbucks'), ('GE','costa'), ('GE','wendys'),
--     ('GE','dunkin'), ('GE','papajohns'), ('AM','dodo'), ('AM','dominos'), ('AM','pizzahut'), ('AM','mcdonalds'),
--     ('AM','burgerking'), ('AM','kfc'), ('AM','subway'), ('AM','starbucks'), ('AM','costa'), ('AM','papajohns'),
--     ('AM','tashir'), ('AZ','dodo'), ('AZ','dominos'), ('AZ','pizzahut'), ('AZ','mcdonalds'), ('AZ','burgerking'),
--     ('AZ','kfc'), ('AZ','subway'), ('AZ','starbucks'), ('AZ','costa'), ('AZ','papajohns'), ('AZ','dunkin'),
--     ('AZ','wendys'), ('KG','dodo'), ('KG','kfc'), ('KG','papajohns'), ('KG','imperiya-pizzy'), ('KG','wok-lagman'),
--     ('KG','begemot'), ('KG','mubarak'), ('KG','navat'), ('KG','coffee-like'), ('TJ','dodo'), ('TJ','kfc'),
--     ('TJ','tajburger'), ('TJ','sfc'), ('TJ','shokoladnitsa')
--
-- ), discovered_now(country, key) as (
--   values
--     ('AM','karas-armenia'), ('AM','mr-gyros'), ('AZ','bir-iki'), ('AZ','pizza-bruno'), ('AZ','pizza-house'), ('AZ','pizza-mizza'),
--     ('AZ','shaurma'), ('BY','chain-пиццалисицца'), ('BY','chain-пиццатемпо'), ('BY','doner-king'), ('BY','grill-kebab'), ('BY','mccafe'),
--     ('BY','nravizza'), ('BY','papa-doner-kebab-pizza'), ('BY','pizza-smile'), ('CY','alfa-pizza'), ('CY','papa-john-s-pizza'), ('CY','pizza-mia'),
--     ('CY','pizza-mine'), ('CY','taco-bell'), ('CY','toronto-pizza'), ('ES','aires-burger-bar'), ('ES','autogrill'), ('ES','bar-paraiso-pizzeria-arepera'),
--     ('ES','big-twins-smash-burger-en-alicante'), ('ES','bodega-el-picadero'), ('ES','burger-house'), ('ES','burger-jazz'), ('ES','can-pizza'), ('ES','carpi-pizza'),
--     ('ES','ciaopizza-es'), ('ES','circo-burger'), ('ES','cotton-grill'), ('ES','da-capo-pizza'), ('ES','darilo-s-pizza'), ('ES','del-poble-pizzeria'),
--     ('ES','dogos'), ('ES','dolce-vita-pizzeries'), ('ES','el-pibe'), ('ES','express-vip-pizzas'), ('ES','fanneli-s-burgers'), ('ES','galipizza'),
--     ('ES','gottan-grill'), ('ES','grill-corner-restaurant-brasa'), ('ES','grill-house'), ('ES','grillmeister'), ('ES','hebe-gyros'), ('ES','i-love-pizza'),
--     ('ES','junk-burger'), ('ES','kebab-nuevo-gijon'), ('ES','kilometros-de-pizza'), ('ES','king-doner-kebab'), ('ES','king-kebab'), ('ES','la-burger-vasca'),
--     ('ES','la-pala-pizzeria-ristorante'), ('ES','la-pepita-burger-bar'), ('ES','la-pizzeria'), ('ES','la-pizzeta'), ('ES','las-fritas'), ('ES','leyenda-burger'),
--     ('ES','machaka-burger'), ('ES','mama-pizza'), ('ES','marruzella-fast-food'), ('ES','masakali-pizza'), ('ES','masamadre-pizza'), ('ES','maxi-pizza'),
--     ('ES','mccafe'), ('ES','mr-pizza'), ('ES','mucho-que-pizza-elda'), ('ES','nap-neapolitan-authentic-pizza'), ('ES','new-york-burger'), ('ES','novapizza-ibi'),
--     ('ES','papa-john-s'), ('ES','papa-john-s-pizza'), ('ES','paparazzi-pizza-e-pasta'), ('ES','papizza'), ('ES','parking-pizza'), ('ES','pizza-a-punt'),
--     ('ES','pizza-city'), ('ES','pizza-express'), ('ES','pizza-house'), ('ES','pizza-loca'), ('ES','pizza-lopez-almeria'), ('ES','pizza-mania'),
--     ('ES','pizza-napoli'), ('ES','pizza-pazza'), ('ES','pizza-royers'), ('ES','pizza-stick'), ('ES','pizza-xxl-cabo-roig'), ('ES','pizza-y-mas'),
--     ('ES','pizzanatura'), ('ES','pizzart'), ('ES','pizzeria'), ('ES','pizzeria-1900'), ('ES','pizzeria-carlos-sevilla'), ('ES','pizzeria-chao-chao'),
--     ('ES','pizzeria-el-barrio-benalmadena'), ('ES','pizzeria-francesco'), ('ES','pizzeria-la-competencia-aviles'), ('ES','pizzeria-la-rustica'), ('ES','pizzeria-mayor'), ('ES','pizzeria-michelangelo'),
--     ('ES','pizzeria-milano'), ('ES','pizzeria-peccato'), ('ES','pizzeria-popeye'), ('ES','pizzeria-regina'), ('ES','pizzeria-san-luis'), ('ES','pizzeria-tivoli'),
--     ('ES','pizzerias-carlos'), ('ES','pizzon-pizza'), ('ES','popeyes-louisiana-kitchen'), ('ES','porta-pizza-gran-canaria'), ('ES','presto-pizza'), ('ES','restaurante-picasso'),
--     ('ES','rosario-s-burgers'), ('ES','royal-pizza'), ('ES','sabores-express'), ('ES','sancho-casual-burger'), ('ES','sandwichez'), ('ES','solopizza-madrid'),
--     ('ES','starkebab'), ('ES','steakburger'), ('ES','sultan-kebab'), ('ES','taco-bell'), ('ES','taxi-angus-american-burger'), ('ES','tepuy-burger'),
--     ('ES','the-good-burger'), ('ES','the-mexican-bar-grill'), ('ES','the-stone-grill'), ('ES','tonipizzeria'), ('ES','toro-burger-lounge'), ('ES','tropicalissima'),
--     ('GE','burger-bar'), ('HU','belfrit'), ('HU','california-burger-dob-utca'), ('HU','deep-burger'), ('HU','doner-king-belarus'), ('HU','duna-doner-debrecen'),
--     ('HU','jack-s-burger'), ('HU','mccafe'), ('HU','nagyi-palacsintazoja-granny-s-pancak'), ('HU','pasa-kebab-szekesfehervar'), ('HU','pizza-express'), ('HU','pizza-firenze'),
--     ('HU','pizza-forte'), ('HU','pizza-karavan-salgotarjan'), ('HU','pizza-me'), ('HU','pizza-monkey'), ('HU','pizza-napoli-felsozsolca'), ('HU','pizza-plus'),
--     ('HU','punto-gelato-cukraszda-es-pizzeria'), ('HU','reinpold-s-kolbice'), ('HU','the-burger-project'), ('HU','trofea-grill-etterem-ujbuda'), ('HU','zing-burger-co'), ('LT','arena-pizza'),
--     ('LT','charlie-pizza'), ('LT','fokus-pizza'), ('LT','grill-london'), ('LT','hesburger'), ('LT','jammi'), ('LT','kebab-inn'),
--     ('LT','mccafe'), ('LT','momo-grill'), ('LT','nr1-pica'), ('LT','oregano-pica'), ('LT','pizza-express'), ('LT','pizza-siracusa'),
--     ('LT','troliu-pica'), ('LT','uno-pica-anyksciai'), ('LT','wraperia-suppa-kebs'), ('MD','corso-pizza'), ('MD','don-cezar-pizza-grill'), ('MD','pizza-mania'),
--     ('MD','starkebab'), ('MD','torro-burgers'), ('MD','wurst'), ('PL','adnan-kebab-jaros-aw'), ('PL','alanya-kebab'), ('PL','am-am-kebab'),
--     ('PL','am-am-kebab-aquafun-legnica'), ('PL','american-pizza-slice-przec-aw'), ('PL','antalya-kebab-tywyn'), ('PL','arif-kebab-restaurant'), ('PL','atmosfera-pizzeria-sochaczew'), ('PL','azan-kebab-i-awa'),
--     ('PL','azhir-kebab'), ('PL','bafra-kebab'), ('PL','bd-king-kebab-kossaka'), ('PL','bd-star-kebab-sztum'), ('PL','berlin-doner-kebap'), ('PL','bobby-burger'),
--     ('PL','burger-house'), ('PL','bursa-kebab-gorzno'), ('PL','byczek-kebab-skalbmierz'), ('PL','canvas-kebab'), ('PL','carat-kebab'), ('PL','casa-della-pizza'),
--     ('PL','century-kebab-grill-krosno-odrzanski'), ('PL','chicago-s-pizza'), ('PL','coffee-pizza-giona-bochnia'), ('PL','cool-pizza-leszno'), ('PL','darul-kebab-ryki'), ('PL','delta-kebab'),
--     ('PL','dhaka-kebab'), ('PL','doner-king-belarus'), ('PL','dostana-kebab'), ('PL','efes-kebab-targowek'), ('PL','ekushe-kebab'), ('PL','enjoy-doner-kebab-miejska-gorka'),
--     ('PL','expert-kebab'), ('PL','express-pizza'), ('PL','express-pizza-wroc-aw'), ('PL','frasses'), ('PL','frentzza-pizza-friends'), ('PL','friends-kebab-zaspa'),
--     ('PL','frytkibelgijskie-pl'), ('PL','g-odna-ma-pa-pizza-chill'), ('PL','garden-kebab-rudnik-nad-sanem'), ('PL','git-burger'), ('PL','goracy-trojkat-pizza-grajewo'), ('PL','great-kebab-pruszcz-gdanski'),
--     ('PL','hasan-kebab'), ('PL','hot-chilli-kebab-olsztyn'), ('PL','i-love-pizza'), ('PL','ilman-kebab'), ('PL','insaf-kebab'), ('PL','ishan-kebab'),
--     ('PL','istanbul-doner-kebap'), ('PL','istanbul-kebab'), ('PL','jamuna-kebab'), ('PL','kebab-center-zwolen'), ('PL','kebab-expert-raciborz'), ('PL','kebab-fiery'),
--     ('PL','kebab-gold'), ('PL','kebab-inn'), ('PL','kebab-inn-raciborz'), ('PL','kebab-magic-pe-czyce'), ('PL','kebab-mark'), ('PL','kebab-nook'),
--     ('PL','kebab-orient-zmigrod'), ('PL','kebab-point-srem'), ('PL','kebab-super-king'), ('PL','kebab-z-ogrodka-bierun'), ('PL','king-kebab'), ('PL','krowa-burger'),
--     ('PL','krowa-burger-sarbinowo'), ('PL','krowa-mac-burgers-jastrzebie'), ('PL','kurczak-z-rozna-na-dolnej'), ('PL','m-doner'), ('PL','magic-pizzeria-es-etterem'), ('PL','mast-kebab-w-oc-awek'),
--     ('PL','max'), ('PL','max-burgers'), ('PL','max-kebab'), ('PL','maxi-pizza'), ('PL','maxi-pizza-sosnowiec'), ('PL','mccafe'),
--     ('PL','mim-kebab'), ('PL','mir-kebab'), ('PL','monsi-kebab-gorzkowice'), ('PL','moon-kebab-trzebnica'), ('PL','nehar-kebab-24h-staro-eka'), ('PL','new-york-pizza-department'),
--     ('PL','noor-kebab'), ('PL','papa-johns-pizza'), ('PL','party-pizza'), ('PL','pepe-pizza'), ('PL','piekarnia-pizzy-krakow'), ('PL','pirat-pizza-wolsztyn'),
--     ('PL','pizza'), ('PL','pizza-66'), ('PL','pizza-express'), ('PL','pizza-factory-inc'), ('PL','pizza-house'), ('PL','pizza-na-wypasie'),
--     ('PL','pizza-station'), ('PL','pizzatopia'), ('PL','pizzeria'), ('PL','pizzeria-105'), ('PL','pizzeria-aniela-nowa-sarzyna'), ('PL','pizzeria-avanti'),
--     ('PL','pizzeria-fantazja'), ('PL','pizzeria-fenix-budva'), ('PL','pizzeria-gang'), ('PL','pizzeria-grande'), ('PL','pizzeria-italia'), ('PL','pizzeria-koliber-w-baranowie-sandomi'),
--     ('PL','pizzeria-milano'), ('PL','pizzeria-muzyczna'), ('PL','pizzeria-nocna-odz-jedzenie-z-dostaw'), ('PL','pizzeria-palermo'), ('PL','pizzeria-peperoni'), ('PL','pizzeria-peperoni-srodmiescie'),
--     ('PL','pizzeria-primavera'), ('PL','pizzeria-raptorius'), ('PL','pizzeria-restauracja-k2-radziejow'), ('PL','pizzeria-ricco'), ('PL','pizzeria-roberto'), ('PL','pizzeria-romano'),
--     ('PL','pizzeria-trattoria-presto-aleksandro'), ('PL','pizzeria-u-batmana-w-radzionkowie'), ('PL','pizzeria-verona-krapkowice'), ('PL','prego-pizza'), ('PL','probe-burger'), ('PL','punto-pizza'),
--     ('PL','pyszny-kebab-bia-a-podlaska'), ('PL','rajshahi-kebab-zbaszynek'), ('PL','raju-kebab-rynek-5-kozle'), ('PL','red-chili-kebab-grill-pizza'), ('PL','robiul-kebab-grill'), ('PL','rollo-kebab'),
--     ('PL','rose-kebab-ujscie'), ('PL','royal-kebab-koluszki'), ('PL','saba-kebab-tczew'), ('PL','sakim-kebab'), ('PL','salad-story'), ('PL','salsiccia-pizzeria-napoletana'),
--     ('PL','sbarro'), ('PL','selfie-spicy-kebab'), ('PL','sevi-kebab'), ('PL','shaik-kebab'), ('PL','sivas-kebab'), ('PL','smak-kebab-lomza'),
--     ('PL','solo-pizza'), ('PL','spicy-kebab-grill'), ('PL','spoko-kebab-brzeg-dolny'), ('PL','star-kebap-pizza'), ('PL','starkebab'), ('PL','stodola'),
--     ('PL','sultan-kebab'), ('PL','surfburger'), ('PL','szamot-pizza'), ('PL','t-pizza'), ('PL','telepizza'), ('PL','the-brand-kebab-and-grill-czarnkow'),
--     ('PL','the-fry'), ('PL','the-king-kebab'), ('PL','the-pizza'), ('PL','u-szwagra'), ('PL','zahir-kebab'), ('PL','zamil-kebab'),
--     ('PL','zarin-kebab-warszawa')
-- ), out_of_scope as (
--   select c.country, c.key
--   from public.mkt_chains c
--   where c.country in ('AM', 'AZ', 'BY', 'CY', 'ES', 'GE', 'HU', 'LT', 'MD', 'PL')
--     and c.origin is null and c.operator is null and c.first_entry is null and c.notes is null and c.hist is null
--     and not exists (select 1 from config_chains k where k.country = c.country and k.key = c.key)
--     and not exists (select 1 from discovered_now k where k.country = c.country and k.key = c.key)
--     and exists (select 1 from public.mkt_locations l where l.country = c.country and l.chain_key = c.key)
--     and not exists (
--       select 1 from public.mkt_locations l
--       where l.country = c.country and l.chain_key = c.key and l.source_kind not in ('osm', 'overture')
--     )
--     and not exists (select 1 from public.mkt_companies x where x.country = c.country and x.chain_key = c.key)
--     and not exists (select 1 from public.mkt_prices x where x.country = c.country and x.chain_key = c.key)
--     and not exists (select 1 from public.mkt_sources x where x.country = c.country and x.chain_key = c.key)
--     and not exists (
--       select 1 from public.mkt_editorial e
--       where e.country = c.country and e.payload::text like '%"' || c.key || '"%'
--     )
--     and c.hidden_at is null
-- )
-- update public.mkt_chains c
-- set hidden_at = now()
-- from out_of_scope o
-- where c.country = o.country and c.key = o.key and c.hidden_at is null;
