// Справочник кодов Natural Earth и региональных групп генератора build-shapes.ts.

export const A3: Record<string, string> = {
  HR: "HRV",
  RO: "ROU",
  EE: "EST",
  RS: "SRB",
  SI: "SVN",
  ME: "MNE",
  BG: "BGR",
  ES: "ESP",
  PL: "POL",
  LT: "LTU",
  CY: "CYP",
  HU: "HUN",
  MD: "MDA",
  BY: "BLR",
};

// Укрупнённые регионы для тренда «по регионам»: области Natural Earth (admin_1) сведены в
// привычные деления страны — как в референсе по Хорватии. В Румынии — 8 регионов развития,
// в Эстонии — 5 регионов NUTS 3, в Сербии — 4 статистических региона (NUTS 2; Natural Earth
// рисует Косово отдельной страной, его округов здесь нет; Расинский округ в NE подписан
// «Pomoravski», оба «Pomoravski» лежат в одном регионе), в Словении — 12 статистических регионов
// (поле region у 193 общин Natural Earth) сведены в 6 исторических земель, в Черногории — три
// статистических региона MONSTAT, Подгорица отдельно, в Болгарии — 6 регионов планирования
// (NUTS 2), София-город отдельно. Испания — 7 макрорегионов NUTS 1 (Канары отдельно), Венгрия —
// 7 регионов NUTS 2, Польша — 7 макрорегионов NUTS 1, Литва — 5 крупных уездов и прочие, Кипр,
// Беларусь — по областям, Молдова — регионы развития, Кишинёв, Гагаузия и Приднестровье. Область без строки
// здесь — ошибка генератора, а не «прочее».
type Area = { ru: string; en: string; a1: string[] };
export const AREAS: Record<string, Area[]> = {
  HR: [
    {
      ru: "Загреб и окрестности",
      en: "Zagreb area",
      a1: ["Grad Zagreb", "Zagrebacka", "Krapinsko-Zagorska"],
    },
    {
      ru: "Далмация",
      en: "Dalmatia",
      a1: [
        "Zadarska",
        "Šibensko-Kninska",
        "Splitsko-Dalmatinska",
        "Dubrovacko-Neretvanska",
      ],
    },
    {
      ru: "Истрия и Кварнер",
      en: "Istria and Kvarner",
      a1: ["Istarska", "Primorsko-Goranska", "Licko-Senjska"],
    },
    {
      ru: "Славония",
      en: "Slavonia",
      a1: [
        "Osjecko-Baranjska",
        "Vukovarsko-Srijemska",
        "Brodsko-Posavska",
        "Požeško-Slavonska",
        "Viroviticko-Podravska",
      ],
    },
    {
      ru: "Север",
      en: "North",
      a1: [
        "Varaždinska",
        "Medimurska",
        "Koprivničko-Križevačka",
        "Bjelovarsko-bilogorska",
      ],
    },
    { ru: "Центр", en: "Centre", a1: ["Sisacko-Moslavacka", "Karlovacka"] },
  ],
  RO: [
    { ru: "Бухарест-Илфов", en: "Bucharest-Ilfov", a1: ["Bucharest", "Ilfov"] },
    {
      ru: "Северо-Запад",
      en: "North-West",
      a1: [
        "Bihor",
        "Bistrita-Nasaud",
        "Cluj",
        "Maramures",
        "Satu Mare",
        "Salaj",
      ],
    },
    {
      ru: "Центр",
      en: "Centre",
      a1: ["Alba", "Brasov", "Covasna", "Harghita", "Mures", "Sibiu"],
    },
    {
      ru: "Северо-Восток",
      en: "North-East",
      a1: ["Bacau", "Botosani", "Iasi", "Neamt", "Suceava", "Vaslui"],
    },
    {
      ru: "Юго-Восток",
      en: "South-East",
      a1: ["Braila", "Buzau", "Constanta", "Galati", "Tulcea", "Vrancea"],
    },
    {
      ru: "Юг — Мунтения",
      en: "South-Muntenia",
      a1: [
        "Arges",
        "Calarasi",
        "Dâmbovita",
        "Giurgiu",
        "Ialomita",
        "Prahova",
        "Teleorman",
      ],
    },
    {
      ru: "Юго-Запад — Олтения",
      en: "South-West Oltenia",
      a1: ["Dolj", "Gorj", "Mehedinti", "Olt", "Vâlcea"],
    },
    {
      ru: "Запад",
      en: "West",
      a1: ["Arad", "Caras-Severin", "Hunedoara", "Timis"],
    },
  ],
  EE: [
    { ru: "Северная Эстония", en: "North Estonia", a1: ["Harju"] },
    {
      ru: "Западная Эстония",
      en: "West Estonia",
      a1: ["Hiiu", "Lääne", "Pärnu", "Saare"],
    },
    {
      ru: "Центральная Эстония",
      en: "Central Estonia",
      a1: ["Järva", "Lääne-Viru", "Rapla"],
    },
    {
      ru: "Северо-Восточная Эстония",
      en: "North-East Estonia",
      a1: ["Ida-Viru"],
    },
    {
      ru: "Южная Эстония",
      en: "South Estonia",
      a1: ["Jõgeva", "Põlva", "Tartu", "Valga", "Viljandi", "Võru"],
    },
  ],
  RS: [
    { ru: "Белград", en: "Belgrade", a1: ["Grad Beograd"] },
    {
      ru: "Воеводина",
      en: "Vojvodina",
      a1: [
        "Severno-Backi",
        "Zapadno-Backi",
        "Južno-Backi",
        "Severno-Banatski",
        "Srednje-Banatski",
        "Južno-Banatski",
        "Sremski",
      ],
    },
    {
      ru: "Шумадия и Западная Сербия",
      en: "Šumadija and Western Serbia",
      a1: [
        "Zlatiborski",
        "Kolubarski",
        "Macvanski",
        "Moravicki",
        "Pomoravski",
        "Raški",
        "Šumadijski",
      ],
    },
    {
      ru: "Южная и Восточная Сербия",
      en: "Southern and Eastern Serbia",
      a1: [
        "Borski",
        "Branicevski",
        "Zajecarski",
        "Jablanicki",
        "Nišavski",
        "Pirotski",
        "Podunavski",
        "Pcinjski",
        "Toplicki",
      ],
    },
  ],
  SI: [
    {
      ru: "Любляна и окрестности",
      en: "Ljubljana area",
      a1: ["Osrednjeslovenska"],
    },
    { ru: "Горенька", en: "Gorenjska", a1: ["Gorenjska"] },
    {
      ru: "Приморье",
      en: "Primorska",
      a1: ["Goriška", "Obalno-kraška", "Notranjsko-kraška"],
    },
    {
      ru: "Штирия и Каринтия",
      en: "Styria and Carinthia",
      a1: ["Podravska", "Savinjska", "Koroška"],
    },
    { ru: "Помурье", en: "Pomurje", a1: ["Pomurska"] },
    {
      ru: "Доленька, Посавье и Засавье",
      en: "Dolenjska, Posavje and Zasavje",
      a1: ["Jugovzhodna Slovenija", "Spodnjeposavska", "Zasavska"],
    },
  ],
  ME: [
    { ru: "Подгорица", en: "Podgorica", a1: ["Podgorica"] },
    { ru: "Центр", en: "Centre", a1: ["Cetinje", "Danilovgrad", "Nikšic"] },
    {
      ru: "Побережье",
      en: "Coast",
      a1: ["Bar", "Budva", "Herceg Novi", "Kotor", "Tivat", "Ulcinj"],
    },
    {
      ru: "Север",
      en: "North",
      a1: [
        "Andrijevica",
        "Berane",
        "Bijelo Polje",
        "Kolašin",
        "Mojkovac",
        "Plav",
        "Pljevlja",
        "Plužine",
        "Rožaje",
        "Šavnik",
        "Žabljak",
      ],
    },
  ],
  BG: [
    { ru: "София", en: "Sofia", a1: ["Grad Sofiya"] },
    {
      ru: "Юго-Запад",
      en: "South-West",
      a1: ["Sofia", "Blagoevgrad", "Pernik", "Kyustendil"],
    },
    {
      ru: "Юг — центр",
      en: "South-Central",
      a1: ["Plovdiv", "Haskovo", "Pazardzhik", "Smolyan", "Kardzhali"],
    },
    {
      ru: "Юго-Восток",
      en: "South-East",
      a1: ["Burgas", "Sliven", "Yambol", "Stara Zagora"],
    },
    {
      ru: "Северо-Восток",
      en: "North-East",
      a1: ["Varna", "Dobrich", "Shumen", "Targovishte"],
    },
    {
      ru: "Север — центр",
      en: "North-Central",
      a1: ["Veliko Tarnovo", "Gabrovo", "Ruse", "Razgrad", "Silistra"],
    },
    {
      ru: "Северо-Запад",
      en: "North-West",
      a1: ["Vidin", "Vratsa", "Montana", "Pleven", "Lovech"],
    },
  ],
  ES: [
    {
      ru: "Северо-запад",
      en: "North-west",
      a1: ["Galicia", "Asturias", "Cantabria"],
    },
    {
      ru: "Северо-восток",
      en: "North-east",
      a1: ["País Vasco", "Foral de Navarra", "La Rioja", "Aragón"],
    },
    { ru: "Мадрид", en: "Madrid", a1: ["Madrid"] },
    {
      ru: "Центр",
      en: "Centre",
      a1: ["Castilla y León", "Castilla-La Mancha", "Extremadura"],
    },
    {
      ru: "Восток",
      en: "East",
      a1: ["Cataluña", "Valenciana", "Islas Baleares"],
    },
    { ru: "Юг", en: "South", a1: ["Andalucía", "Murcia", "Ceuta", "Melilla"] },
    { ru: "Канары", en: "Canary Islands", a1: ["Canary Is."] },
  ],
  HU: [
    { ru: "Будапешт и Пешт", en: "Budapest and Pest", a1: ["Central Hungary"] },
    {
      ru: "Центральное Задунавье",
      en: "Central Transdanubia",
      a1: ["Central Transdanubia"],
    },
    {
      ru: "Западное Задунавье",
      en: "Western Transdanubia",
      a1: ["Western Transdanubia"],
    },
    {
      ru: "Южное Задунавье",
      en: "Southern Transdanubia",
      a1: ["Southern Transdanubia"],
    },
    {
      ru: "Северная Венгрия",
      en: "Northern Hungary",
      a1: ["Northern Hungary"],
    },
    {
      ru: "Северный Альфёльд",
      en: "Northern Great Plain",
      a1: ["Northern Great Plain"],
    },
    {
      ru: "Южный Альфёльд",
      en: "Southern Great Plain",
      a1: ["Great Southern Plain"],
    },
  ],
  PL: [
    { ru: "Мазовия", en: "Masovia", a1: ["Masovian"] },
    { ru: "Юг", en: "South", a1: ["Lesser Poland", "Silesian"] },
    { ru: "Юго-запад", en: "South-west", a1: ["Lower Silesian", "Opole"] },
    {
      ru: "Северо-запад",
      en: "North-west",
      a1: ["Greater Poland", "West Pomeranian", "Lubusz"],
    },
    {
      ru: "Север",
      en: "North",
      a1: ["Pomeranian", "Kuyavian-Pomeranian", "Warmian-Masurian"],
    },
    { ru: "Центр", en: "Centre", a1: ["Łódź", "Świętokrzyskie"] },
    { ru: "Восток", en: "East", a1: ["Lublin", "Subcarpathian", "Podlachian"] },
  ],
  LT: [
    { ru: "Вильнюсский уезд", en: "Vilnius county", a1: ["Vilniaus"] },
    { ru: "Каунасский уезд", en: "Kaunas county", a1: ["Kauno"] },
    { ru: "Клайпедский уезд", en: "Klaip\u0117da county", a1: ["Klaipedos"] },
    { ru: "Шяуляйский уезд", en: "\u0160iauliai county", a1: ["Šiauliai"] },
    {
      ru: "Паневежский уезд",
      en: "Panev\u0117\u017eys county",
      a1: ["Panevezio"],
    },
    {
      ru: "Остальные уезды",
      en: "Other counties",
      a1: ["Alytaus", "Marijampoles", "Taurages", "Telšiai", "Utenos"],
    },
  ],
  CY: [
    { ru: "Никосия", en: "Nicosia", a1: ["Nicosia"] },
    { ru: "Лимасол", en: "Limassol", a1: ["Limassol"] },
    { ru: "Ларнака", en: "Larnaca", a1: ["Larnaca"] },
    { ru: "Пафос", en: "Paphos", a1: ["Paphos"] },
    { ru: "Фамагуста", en: "Famagusta", a1: ["Famagusta"] },
  ],
  BY: [
    { ru: "Минск", en: "Minsk city", a1: ["City of Minsk"] },
    { ru: "Минская обл.", en: "Minsk region", a1: ["Minsk"] },
    { ru: "Брестская обл.", en: "Brest region", a1: ["Brest"] },
    { ru: "Гомельская обл.", en: "Gomel region", a1: ["Gomel"] },
    { ru: "Гродненская обл.", en: "Grodno region", a1: ["Grodno"] },
    { ru: "Могилёвская обл.", en: "Mogilev region", a1: ["Mogilev"] },
    { ru: "Витебская обл.", en: "Vitebsk region", a1: ["Vitebsk"] },
  ],
  MD: [
    { ru: "Кишинёв", en: "Chi\u0219in\u0103u", a1: ["Chişinău"] },
    {
      ru: "Север",
      en: "North",
      a1: [
        "Briceni",
        "Bălţi",
        "Donduseni",
        "Drochia",
        "Edineţ",
        "Floreşti",
        "Făleşti",
        "Glodeni",
        "Ocniţa",
        "Rîşcani",
        "Soroca",
        "Sîngerei",
      ],
    },
    {
      ru: "Центр",
      en: "Centre",
      a1: [
        "Anenii Noi",
        "Călărași",
        "Criuleni",
        "Hîncesti",
        "Ialoveni",
        "Nisporeni",
        "Orhei",
        "Rezina",
        "Străşeni",
        "Şoldăneşti",
        "Teleneşti",
        "Ungheni",
      ],
    },
    {
      ru: "Юг",
      en: "South",
      a1: [
        "Basarabeasca",
        "Cahul",
        "Cantemir",
        "Causeni",
        "Cimişlia",
        "Leova",
        "Taraclia",
        "Ștefan Vodă",
      ],
    },
    { ru: "Гагаузия", en: "Gagauzia", a1: ["Comrat"] },
    {
      ru: "Приднестровье",
      en: "Transnistria",
      a1: [
        "Bender",
        "Camenca",
        "Grigoriopol",
        "Stîngă Nistrului",
        "Transnistria",
      ],
    },
  ],
};
/** Поле admin_1, по которому области сводятся в регионы: обычно name, у Словении — region. */
export const AREA_FIELD: Record<string, string> = {
  SI: "region",
  ES: "region",
  HU: "region",
};
