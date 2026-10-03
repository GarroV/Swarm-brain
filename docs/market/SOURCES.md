<!-- Генерируется: deno run -A scripts/market/sources-doc.ts > docs/market/SOURCES.md. Руками не править — правится конфиг страны (scripts/market/countries/<CC>.ts) или описание адаптера (about). -->
# Реестр источников «Анализа рынка»

Что, откуда и как часто собирается по каждой стране. Строки «авто» гоняет сборщик по расписанию (`scripts/market/run.ts`), строки «вручную» — ручная заливка снимком; у них в колонке «Сверено» — дата, когда человек последний раз проверял, что источник жив и формат не поменялся. Как добавить страну — [README](README.md).

## HR — Хорватия

| Что | Откуда | Что именно | Как | Частота | Сверено |
|---|---|---|---|---|---|
| Продажи Dodo | https://publicapi.dodois.io/hr/api/v1/ | пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ, для динара — НБС (kurs.resenje.org) | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://publicapi.dodois.io/hr/api/v1/ | сеть dodo: пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ, для динара — НБС (kurs.resenje.org) | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://overpass-api.de/api/interpreter | точки сетей по тегу brand (osmBrands в конфиге) или по началу name среди заведений общепита (osmNames) из OpenStreetMap, координаты, адрес, дата открытия, если она есть в теге; город — из addr:city, а без него — ближайший place=city в пределах 15 км, нет города — ближайший place=town | авто, `osm-overpass` | раз в неделю | — |
| Точки | снимок ручных источников (импорт в «Источниках и свежести») | локальные сети и пекарни с датами открытия: локаторы сетей, Wolt, пресса; дата — по посту сети, появлению в Wolt или первому отзыву, а не по дате статьи | вручную | по запросу | 2026-10-02 |
| Выручки юрлиц | https://www.fina.hr (Info.BIZ), companywall.hr | выручка и сотрудники юрлиц из companies снимка; OIB — рег. номер (Fina Info.BIZ: вход по учётной записи, условия запрещают перепубликацию — обновление раз в год вручную) | вручную | по запросу | 2026-10-02 |
| Цены | сайты сетей и Wolt | средняя пицца ~30 см (маргарита, пепперони, ветчина-грибы, премиум) — свой сайт и Wolt, акции | вручную | по запросу | 2026-10-01 |
| Факты рынка | пресса, отчёты платформ доставки и мастер-франчайзи | события сетей, рынок доставки, факты рынка; ручная часть экрана — блоки editorial снимка | вручную | по запросу | 2026-10-02 |

Сети (по чему их ищет `osm-overpass`: тег brand или начало name; пусто — сети в OSM нет, точки из других источников):

| Ключ | Сеть | Сегмент | Поиск в OSM |
|---|---|---|---|
| `dodo` | Dodo Pizza | pizza | — |
| `dominos` | Domino's | pizza | brand: Domino's, Domino's Pizza |
| `pizzahut` | Pizza Hut | pizza | brand: Pizza Hut |
| `pizzaexpress_hr` | Pizza Express HR | pizza | — |
| `tuttobene` | TuttoBene Pizzeria & Fast Food | pizza | — |
| `mcdonalds` | McDonald's | burger | brand: McDonald's |
| `burgerking` | Burger King | burger | brand: Burger King |
| `submarine-burger` | Submarine Burger | burger | — |
| `kfc` | KFC | chicken | brand: KFC |
| `batak-grill` | Batak Grill | grill | — |
| `mlinar` | Mlinar | bakery, пекарня | brand: Mlinar |
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
| Продажи Dodo | https://publicapi.dodois.io/ro/api/v1/ | пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ, для динара — НБС (kurs.resenje.org) | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://publicapi.dodois.io/ro/api/v1/ | сеть dodo: пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ, для динара — НБС (kurs.resenje.org) | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://overpass-api.de/api/interpreter | точки сетей по тегу brand (osmBrands в конфиге) или по началу name среди заведений общепита (osmNames) из OpenStreetMap, координаты, адрес, дата открытия, если она есть в теге; город — из addr:city, а без него — ближайший place=city в пределах 15 км, нет города — ближайший place=town | авто, `osm-overpass` | раз в неделю | — |
| Выручки юрлиц | https://data.gov.ro (набор situatii financiare) | годовая отчётность юрлиц Румынии по CUI из companies: оборот и сотрудники; лей → евро по годовому курсу ЕЦБ | авто, `ro-datagov` | раз в год | — |
| Цены | — | ещё не собирались | вручную | по запросу | — |
| Факты рынка | — | ещё не собирались; ручной части нет | вручную | по запросу | — |

Сети (по чему их ищет `osm-overpass`: тег brand или начало name; пусто — сети в OSM нет, точки из других источников):

| Ключ | Сеть | Сегмент | Поиск в OSM |
|---|---|---|---|
| `dodo` | Dodo Pizza | pizza | — |
| `dominos` | Domino's | pizza | brand: Domino's, Domino's Pizza |
| `pizzahut` | Pizza Hut | pizza | brand: Pizza Hut, Pizza Hut Delivery |
| `jerrys` | Jerry's Pizza | pizza | brand: Jerry's Pizza, Jerry’s Pizza; name: Jerry's Pizza, Jerry’s Pizza, Jerrys Pizza |
| `mcdonalds` | McDonald's | burger | brand: McDonald's |
| `burgerking` | Burger King | burger | brand: Burger King |
| `kfc` | KFC | chicken | brand: KFC |
| `subway` | Subway | sandwich | brand: Subway |
| `spartan` | Spartan | grill | brand: Spartan |
| `saladbox` | Salad Box | other | brand: Salad Box |

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
| Продажи Dodo | https://publicapi.dodois.io/ee/api/v1/ | пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ, для динара — НБС (kurs.resenje.org) | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://publicapi.dodois.io/ee/api/v1/ | сеть dodo: пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ, для динара — НБС (kurs.resenje.org) | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://overpass-api.de/api/interpreter | точки сетей по тегу brand (osmBrands в конфиге) или по началу name среди заведений общепита (osmNames) из OpenStreetMap, координаты, адрес, дата открытия, если она есть в теге; город — из addr:city, а без него — ближайший place=city в пределах 15 км, нет города — ближайший place=town | авто, `osm-overpass` | раз в неделю | — |
| Выручки юрлиц | https://avaandmed.ariregister.rik.ee | годовые отчёты юрлиц Эстонии (открытые данные e-Äriregister): выручка и сотрудники по рег. коду из companies | авто, `ee-ariregister` | раз в месяц | — |
| Цены | — | ещё не собирались | вручную | по запросу | — |
| Факты рынка | — | ещё не собирались; ручной части нет | вручную | по запросу | — |

Сети (по чему их ищет `osm-overpass`: тег brand или начало name; пусто — сети в OSM нет, точки из других источников):

| Ключ | Сеть | Сегмент | Поиск в OSM |
|---|---|---|---|
| `dodo` | Dodo Pizza | pizza | — |
| `dominos` | Domino's | pizza | brand: Domino's, Domino's Pizza |
| `peetri` | Peetri Pizza | pizza | brand: Peetri Pizza |
| `kotipizza` | Kotipizza | pizza | brand: Kotipizza |
| `mcdonalds` | McDonald's | burger | brand: McDonald's |
| `hesburger` | Hesburger | burger | brand: Hesburger |
| `burgerking` | Burger King | burger | brand: Burger King |
| `kfc` | KFC | chicken | brand: KFC |
| `subway` | Subway | sandwich | brand: Subway |

Юрлица операторов (по рег. номеру их ищут адаптеры реестров):

| Сеть | Юрлицо | Рег. номер |
|---|---|---|
| dodo | Osaühing VIP Shop | 11452320 |
| dodo | DigiLike OÜ | 14924021 |
| hesburger | AS Hesburger | 10312806 |

## RS — Сербия

| Что | Откуда | Что именно | Как | Частота | Сверено |
|---|---|---|---|---|---|
| Продажи Dodo | https://publicapi.dodois.io/rs/api/v1/ | пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ, для динара — НБС (kurs.resenje.org) | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://publicapi.dodois.io/rs/api/v1/ | сеть dodo: пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ, для динара — НБС (kurs.resenje.org) | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://overpass-api.de/api/interpreter | точки сетей по тегу brand (osmBrands в конфиге) или по началу name среди заведений общепита (osmNames) из OpenStreetMap, координаты, адрес, дата открытия, если она есть в теге; город — из addr:city, а без него — ближайший place=city в пределах 15 км, нет города — ближайший place=town | авто, `osm-overpass` | раз в неделю | 2026-10-02 |
| Выручки юрлиц | https://www.companywall.<страна>/firma\|podjetje/<slug>/<id> (ссылки — в companies.url конфига) | общие доходы (Ukupni prihodi) — шире выручки от продаж; выручки от продаж (poslovni prihodi) есть только в APR (fin.apr.gov.rs) за капчей | авто, `companywall` | раз в год | 2026-10-02 |
| Цены | Wolt (JSON меню по slug заведения, без входа) | ещё не собирались; кандидат в автоматический адаптер | вручную | по запросу | — |
| Факты рынка | — | ещё не собирались; ручной части нет | вручную | по запросу | — |

Сети (по чему их ищет `osm-overpass`: тег brand или начало name; пусто — сети в OSM нет, точки из других источников):

| Ключ | Сеть | Сегмент | Поиск в OSM |
|---|---|---|---|
| `dodo` | Dodo Pizza | pizza | — |
| `pizzahut` | Pizza Hut | pizza | brand: Pizza Hut |
| `caribic` | Caribic Pizza | pizza | name: Caribic, Карибик |
| `mcdonalds` | McDonald's | burger | brand: McDonald's, McDonalds, Мекдоналдс, Макдоналдс |
| `burgerking` | Burger King | burger | brand: Burger King |
| `kfc` | KFC | chicken | brand: KFC |
| `walter` | Walter | grill | name: Walter, Валтер |
| `tacobell` | Taco Bell | other | brand: Taco Bell |
| `burrito-madre` | Burrito Madre | other | name: Burrito Madre |
| `starbucks` | Starbucks | coffee | brand: Starbucks, Старбакс |
| `skroz-dobra-pekara` | Skroz dobra pekara | bakery, пекарня | name: Skroz dobra pekara, Скроз добра пекара |
| `hleb-i-kifle` | Hleb i kifle | bakery, пекарня | name: Hleb i kifle, Хлеб и кифле |
| `zlatni-klas` | Zlatni klas | bakery, пекарня | name: Zlatni klas, Златни клас |

Юрлица операторов (по рег. номеру их ищут адаптеры реестров):

| Сеть | Юрлицо | Рег. номер |
|---|---|---|
| dodo | Anton Nefedev PR Picerije ANGARA | 66479366 |
| mcdonalds | Nicefoods Restorani d.o.o. | 07092652 |
| kfc | AmRest d.o.o. | 20343052 |
| starbucks | AmRest Coffee SRB d.o.o. | 21335517 |
| walter | Walter BBQ d.o.o. | 21093564 |
| caribic | MMM Pizza Group d.o.o. | 20526068 |
| skroz-dobra-pekara | Trgocentar d.o.o. | 07773820 |
| hleb-i-kifle | Hleb i kifle d.o.o. | 20301708 |

## SI — Словения

| Что | Откуда | Что именно | Как | Частота | Сверено |
|---|---|---|---|---|---|
| Продажи Dodo | https://publicapi.dodois.io/si/api/v1/ | пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ, для динара — НБС (kurs.resenje.org) | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://publicapi.dodois.io/si/api/v1/ | сеть dodo: пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ, для динара — НБС (kurs.resenje.org) | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://overpass-api.de/api/interpreter | точки сетей по тегу brand (osmBrands в конфиге) или по началу name среди заведений общепита (osmNames) из OpenStreetMap, координаты, адрес, дата открытия, если она есть в теге; город — из addr:city, а без него — ближайший place=city в пределах 15 км, нет города — ближайший place=town | авто, `osm-overpass` | раз в неделю | 2026-10-02 |
| Выручки юрлиц | https://www.companywall.<страна>/firma\|podjetje/<slug>/<id> (ссылки — в companies.url конфига) | все доходы (Celotni prihodki, AJPES) — шире выручки от продаж; у McDonald's несколько франчайзи, юрлица сети нет | авто, `companywall` | раз в год | 2026-10-02 |
| Цены | Wolt (JSON меню по slug заведения, без входа) | ещё не собирались; кандидат в автоматический адаптер | вручную | по запросу | — |
| Факты рынка | — | ещё не собирались; ручной части нет | вручную | по запросу | — |

Сети (по чему их ищет `osm-overpass`: тег brand или начало name; пусто — сети в OSM нет, точки из других источников):

| Ключ | Сеть | Сегмент | Поиск в OSM |
|---|---|---|---|
| `dodo` | Dodo Pizza | pizza | — |
| `mcdonalds` | McDonald's | burger | brand: McDonald's, McDonalds |
| `burgerking` | Burger King | burger | brand: Burger King |
| `hood-burger` | Hood Burger | burger | name: Hood Burger |
| `hot-horse` | Hot Horse | burger | name: Hot Horse |
| `kfc` | KFC | chicken | brand: KFC |
| `subway` | Subway | sandwich | brand: Subway |
| `chutys` | Chuty's | other | name: Chuty's, Chutys |
| `pecjak` | Pekarna Pečjak | bakery, пекарня | name: Pekarna Pečjak, Pečjak |
| `zito` | Žito | bakery, пекарня | name: Žito, Pekarna Žito |
| `brumat` | Pekarna Brumat | bakery, пекарня | name: Pekarna Brumat, Brumat |
| `mlinar` | Mlinar | bakery, пекарня | brand: Mlinar; name: Mlinar, Pekarna Mlinar |

Юрлица операторов (по рег. номеру их ищут адаптеры реестров):

| Сеть | Юрлицо | Рег. номер |
|---|---|---|
| dodo | Fovella d.o.o. | 8065152000 |
| chutys | Chutis d.o.o. | 6414184000 |
| hot-horse | Hot - Horse d.o.o. | 5873525000 |
| pecjak | Pekarna Pečjak d.o.o. | 5879612000 |
| brumat | Pekarna Brumat d.o.o. | 5986613000 |

## ME — Черногория

| Что | Откуда | Что именно | Как | Частота | Сверено |
|---|---|---|---|---|---|
| Продажи Dodo | https://publicapi.dodois.io/me/api/v1/ | пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ, для динара — НБС (kurs.resenje.org) | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://publicapi.dodois.io/me/api/v1/ | сеть dodo: пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ, для динара — НБС (kurs.resenje.org) | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://overpass-api.de/api/interpreter | точки сетей по тегу brand (osmBrands в конфиге) или по началу name среди заведений общепита (osmNames) из OpenStreetMap, координаты, адрес, дата открытия, если она есть в теге; город — из addr:city, а без него — ближайший place=city в пределах 15 км, нет города — ближайший place=town | авто, `osm-overpass` | раз в неделю | 2026-10-03 |
| Выручки юрлиц | https://www.companywall.<страна>/firma\|podjetje/<slug>/<id> (ссылки — в companies.url конфига) | все доходы (Ukupni prihodi, налоговая) — шире выручки от продаж; сотрудники только за последний год; у Pekara Montenegro много юрлиц | авто, `companywall` | раз в год | 2026-10-03 |
| Цены | Wolt (JSON меню по slug заведения, без входа) | ещё не собирались; кандидат в автоматический адаптер | вручную | по запросу | — |
| Факты рынка | — | ещё не собирались; ручной части нет | вручную | по запросу | — |

Сети (по чему их ищет `osm-overpass`: тег brand или начало name; пусто — сети в OSM нет, точки из других источников):

| Ключ | Сеть | Сегмент | Поиск в OSM |
|---|---|---|---|
| `dodo` | Dodo Pizza | pizza | — |
| `pizzahut` | Pizza Hut | pizza | brand: Pizza Hut; name: Pizza Hut |
| `burgerking` | Burger King | burger | brand: Burger King |
| `walter` | Walter | grill | name: Walter, Валтер |
| `caffeine` | Caffeine Coffee Shop | coffee | name: Caffeine Coffee Shop, Caffeine |
| `pekara-montenegro` | Pekara Montenegro | bakery, пекарня | name: Pekara Montenegro |
| `pekara-sicilia` | Pekara Sicilia | bakery, пекарня | name: Pekara Sicilia |

Юрлица операторов (по рег. номеру их ищут адаптеры реестров):

| Сеть | Юрлицо | Рег. номер |
|---|---|---|
| dodo | Food V. d.o.o. | 03671429 |
| caffeine | Caffeine Company d.o.o. | 03075966 |

## BG — Болгария

| Что | Откуда | Что именно | Как | Частота | Сверено |
|---|---|---|---|---|---|
| Продажи Dodo | https://publicapi.dodois.io/bg/api/v1/ | пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ, для динара — НБС (kurs.resenje.org) | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://publicapi.dodois.io/bg/api/v1/ | сеть dodo: пиццерии Dodo (unitinfo/all: адрес, координаты, BeginDateWork) и выручка по месяцам с числом пиццерий; курс к евро — ЕЦБ, для динара — НБС (kurs.resenje.org) | авто, `dodo-publicapi` | раз в неделю | — |
| Точки | https://overpass-api.de/api/interpreter | точки сетей по тегу brand (osmBrands в конфиге) или по началу name среди заведений общепита (osmNames) из OpenStreetMap, координаты, адрес, дата открытия, если она есть в теге; город — из addr:city, а без него — ближайший place=city в пределах 15 км, нет города — ближайший place=town | авто, `osm-overpass` | раз в неделю | 2026-10-03 |
| Выручки юрлиц | Търговски регистър (registryagency.bg) — годовые отчёты PDF | бесплатного машинного источника нет: papagal.bg за защитой от ботов, companybook.bg и finansi.bg — 2024–2025 платно; платное не берём — выручка вручную в снимок из открытых публикаций | вручную | по запросу | — |
| Цены | Wolt / Glovo (JSON меню по slug заведения, без входа) | ещё не собирались; кандидат в автоматический адаптер | вручную | по запросу | — |
| Факты рынка | — | ещё не собирались; ручной части нет | вручную | по запросу | — |

Сети (по чему их ищет `osm-overpass`: тег brand или начало name; пусто — сети в OSM нет, точки из других источников):

| Ключ | Сеть | Сегмент | Поиск в OSM |
|---|---|---|---|
| `dodo` | Dodo Pizza | pizza | — |
| `dominos` | Domino's | pizza | brand: Domino's, Domino's Pizza |
| `papajohns` | Papa John's | pizza | brand: Papa John's |
| `pizzalab` | Pizza Lab | pizza | brand: Pizza Lab |
| `mcdonalds` | McDonald's | burger | brand: McDonald's, McDonalds, Макдоналдс |
| `burgerking` | Burger King | burger | brand: Burger King |
| `hesburger` | Hesburger | burger | brand: Hesburger |
| `skapto` | Skapto | burger | name: Skapto, Скапто |
| `kfc` | KFC | chicken | brand: KFC |
| `subway` | Subway | sandwich | brand: Subway |
| `go-grill` | GO Grill | grill | brand: GO Grill |
| `happy` | Happy Bar & Grill | grill | brand: Happy Bar & Grill |
| `aladin` | Aladin Foods | other | brand: Aladin Foods |
| `starbucks` | Starbucks | coffee | brand: Starbucks |
| `costa` | Costa Coffee | coffee | brand: Costa |
| `fornetti` | Fornetti | bakery, пекарня | brand: Fornetti |
| `sofiyska-banitsa` | Sofiyska banitsa | bakery, пекарня | brand: Софийска баница |
| `kings-bakery` | King's Bakery | bakery, пекарня | name: King's Bakery |
