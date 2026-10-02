<!-- Генерируется: deno run -A scripts/market/sources-doc.ts > docs/market/SOURCES.md. Руками не править — правится конфиг страны (scripts/market/countries/<CC>.ts) или описание адаптера (about). -->
# Реестр источников «Анализа рынка»

Что, откуда и как часто собирается по каждой стране. Строки «авто» гоняет сборщик по расписанию (`scripts/market/run.ts`), строки «вручную» — ручная заливка снимком; у них в колонке «Сверено» — дата, когда человек последний раз проверял, что источник жив и формат не поменялся. Как добавить страну — [README](README.md).

## HR — Хорватия

| Что | Откуда | Что именно | Как | Частота | Сверено |
|---|---|---|---|---|---|
| Продажи Dodo | https://publicapi.dodois.io/hr/api/v1/ | пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://publicapi.dodois.io/hr/api/v1/ | сеть dodo: пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://overpass-api.de/api/interpreter | точки сетей по тегам brand / name из OpenStreetMap (osmBrands в конфиге), координаты, адрес, дата открытия, если она есть в теге | авто, `osm-overpass` | раз в неделю | — |
| Точки | снимок ручных источников (импорт в «Источниках и свежести») | локальные сети и пекарни с датами открытия: локаторы сетей, Wolt, пресса; дата — по посту сети, появлению в Wolt или первому отзыву, а не по дате статьи | вручную | по запросу | 2026-10-02 |
| Выручки юрлиц | https://www.fina.hr (Info.BIZ), companywall.hr | выручка и сотрудники юрлиц из companies снимка; OIB — рег. номер (Fina Info.BIZ: вход по учётной записи, условия запрещают перепубликацию — обновление раз в год вручную) | вручную | по запросу | 2026-10-02 |
| Цены | сайты сетей и Wolt | средняя пицца ~30 см (маргарита, пепперони, ветчина-грибы, премиум) — свой сайт и Wolt, акции | вручную | по запросу | 2026-10-01 |
| Факты рынка | пресса, отчёты платформ доставки и мастер-франчайзи | события сетей, рынок доставки, факты рынка; ручная часть экрана — блоки editorial снимка | вручную | по запросу | 2026-10-02 |

Сети (теги OSM — по ним ищет `osm-overpass`; пусто — сети в OSM нет, точки из других источников):

| Ключ | Сеть | Сегмент | Теги brand в OSM |
|---|---|---|---|
| `dodo` | Dodo Pizza | pizza | — |
| `dominos` | Domino's | pizza | Domino's, Domino's Pizza |
| `pizzahut` | Pizza Hut | pizza | Pizza Hut |
| `pizzaexpress_hr` | Pizza Express HR | pizza | — |
| `tuttobene` | TuttoBene Pizzeria & Fast Food | pizza | — |
| `mcdonalds` | McDonald's | burger | McDonald's |
| `burgerking` | Burger King | burger | Burger King |
| `submarine-burger` | Submarine Burger | burger | — |
| `kfc` | KFC | chicken | KFC |
| `batak-grill` | Batak Grill | grill | — |
| `mlinar` | Mlinar | bakery, пекарня | Mlinar |
| `pan-pek` | Pan-Pek | bakery, пекарня | — |
| `pekara-dubravica` | Pekara Dubravica | bakery, пекарня | — |
| `leggiero` | Leggiero / Leggiero Food | coffee, пекарня | — |
| `gyotaku` | Gyotaku | asian | — |
| `koykan` | Koykan | asian | — |
| `purple-monkey` | Purple Monkey | asian | — |
| `umami` | Umami | asian | — |
| `wok-me` | Wok Me | asian | — |
| `good-food` | Good Food | other | — |
| `biberon` | Biberon Food | other | — |
| `foodie` | Foodie | other | — |
| `pasta-fasta` | Pasta Fasta | other | — |

## RO — Румыния

| Что | Откуда | Что именно | Как | Частота | Сверено |
|---|---|---|---|---|---|
| Продажи Dodo | https://publicapi.dodois.io/ro/api/v1/ | пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://publicapi.dodois.io/ro/api/v1/ | сеть dodo: пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://overpass-api.de/api/interpreter | точки сетей по тегам brand / name из OpenStreetMap (osmBrands в конфиге), координаты, адрес, дата открытия, если она есть в теге | авто, `osm-overpass` | раз в неделю | — |
| Выручки юрлиц | https://data.gov.ro (набор situatii financiare) | годовая отчётность юрлиц Румынии по CUI из companies: оборот и сотрудники; лей → евро по годовому курсу ЕЦБ | авто, `ro-datagov` | раз в год | — |
| Цены | — | ещё не собирались | вручную | по запросу | — |
| Факты рынка | — | ещё не собирались; ручной части нет | вручную | по запросу | — |

Сети (теги OSM — по ним ищет `osm-overpass`; пусто — сети в OSM нет, точки из других источников):

| Ключ | Сеть | Сегмент | Теги brand в OSM |
|---|---|---|---|
| `dodo` | Dodo Pizza | pizza | — |
| `dominos` | Domino's | pizza | Domino's, Domino's Pizza |
| `pizzahut` | Pizza Hut | pizza | Pizza Hut, Pizza Hut Delivery |
| `jerrys` | Jerry's Pizza | pizza | Jerry's Pizza |
| `mcdonalds` | McDonald's | burger | McDonald's |
| `burgerking` | Burger King | burger | Burger King |
| `kfc` | KFC | chicken | KFC |
| `subway` | Subway | sandwich | Subway |
| `spartan` | Spartan | grill | Spartan |
| `saladbox` | Salad Box | other | Salad Box |

Юрлица операторов (по рег. номеру их ищут адаптеры реестров):

| Сеть | Юрлицо | Рег. номер |
|---|---|---|
| dodo | Dodo Pizza Lujerului SRL | 25834486 |
| dodo | Dodo Pizza Coresi SRL | 22787860 |
| mcdonalds | Premier Restaurants Romania SRL | 6205722 |
| kfc | Sphera Franchise Group SA (holding) | 37586457 |
| dominos | Domino's Pizza Maxim SRL | 24335356 |
| jerrys | Jerry's Pizza Est SRL | 10556918 |
| jerrys | Jerry's Pizza Nord SRL | 14509340 |

## EE — Эстония

| Что | Откуда | Что именно | Как | Частота | Сверено |
|---|---|---|---|---|---|
| Продажи Dodo | https://publicapi.dodois.io/ee/api/v1/ | пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://publicapi.dodois.io/ee/api/v1/ | сеть dodo: пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://overpass-api.de/api/interpreter | точки сетей по тегам brand / name из OpenStreetMap (osmBrands в конфиге), координаты, адрес, дата открытия, если она есть в теге | авто, `osm-overpass` | раз в неделю | — |
| Выручки юрлиц | https://avaandmed.ariregister.rik.ee | годовые отчёты юрлиц Эстонии (открытые данные e-Äriregister): выручка и сотрудники по рег. коду из companies | авто, `ee-ariregister` | раз в месяц | — |
| Цены | — | ещё не собирались | вручную | по запросу | — |
| Факты рынка | — | ещё не собирались; ручной части нет | вручную | по запросу | — |

Сети (теги OSM — по ним ищет `osm-overpass`; пусто — сети в OSM нет, точки из других источников):

| Ключ | Сеть | Сегмент | Теги brand в OSM |
|---|---|---|---|
| `dodo` | Dodo Pizza | pizza | — |
| `dominos` | Domino's | pizza | Domino's, Domino's Pizza |
| `peetri` | Peetri Pizza | pizza | Peetri Pizza |
| `kotipizza` | Kotipizza | pizza | Kotipizza |
| `mcdonalds` | McDonald's | burger | McDonald's |
| `hesburger` | Hesburger | burger | Hesburger |
| `burgerking` | Burger King | burger | Burger King |
| `kfc` | KFC | chicken | KFC |
| `subway` | Subway | sandwich | Subway |

Юрлица операторов (по рег. номеру их ищут адаптеры реестров):

| Сеть | Юрлицо | Рег. номер |
|---|---|---|
| dodo | Osaühing VIP Shop | 11452320 |
| dodo | DigiLike OÜ | 14924021 |
| hesburger | AS Hesburger | 10312806 |
