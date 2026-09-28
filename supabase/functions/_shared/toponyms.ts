// Города и регионы → страна. Нужен ОДНОМУ потребителю: контексту рекордера
// («С прошлого раза», issue #226/#229).
//
// Почему отдельный словарь, а не расширение ALIASES в countries.ts: тот словарь общий —
// на нём стоят подсказка рынка при вычитке встречи и буст по стране в поиске. Город,
// упомянутый вскользь, там сразу начнёт вешать страну на запись, а переTAGивание у нас
// уже есть и без городов. Здесь же цена промаха другая: не то тег на записи, а пустой
// блок в панели рекордера. Поэтому расширяем ровно один путь.
//
// Правило отбора (владелец 03.09.2026: «тут должно быть максимальное совпадение»):
// берём ТОЛЬКО однозначные топонимы наших рынков. Не берём:
//   • город, который есть в двух странах: Брест (BY/FR), Санкт-Петербург во Флориде не в счёт;
//   • совпадающие с обычным словом или именем: Бар (ME), Ниш (RS), София (BG — женское имя),
//     Русе (BG — «ruse»), Сплит (HR — «сплит-тест», англ. split), Гянджа (AZ), Ош (KG),
//     Гоа латиницей («goa» → префикс поймает «goal»), Берн («bern» → «Bernard»),
//     Тарту кириллицей (стем «тарт» + падежное окончание = «тарта»), Питер (имя);
//   • Котор кириллицей: стем «котор» + окончание «ой» из закрытого набора = «которой».
//     Латиницей «kotor» безопасен, поэтому он в словаре, а кириллица — нет.
// Каждое исключение здесь стоило бы ложной страны в панели, поэтому список консервативный:
// лучше пустой блок, чем тезисы чужого рынка.
import { detectAliasCountries } from "./countries.ts";

export const TOPONYMS: Record<string, string> = {
  // RS
  "белград": "RS", "belgrade": "RS", "beograd": "RS",
  "нови-сад": "RS", "нови сад": "RS", "novi sad": "RS",
  "крагуевац": "RS", "kragujevac": "RS",
  "суботица": "RS", "subotica": "RS",
  "воеводина": "RS", "vojvodina": "RS",
  // HR
  "загреб": "HR", "zagreb": "HR",
  "риека": "HR", "rijeka": "HR",
  "дубровник": "HR", "dubrovnik": "HR",
  "осиек": "HR", "osijek": "HR",
  "задар": "HR", "zadar": "HR",
  "истрия": "HR", "istria": "HR",
  // SI
  "любляна": "SI", "ljubljana": "SI",
  "марибор": "SI", "maribor": "SI",
  "целе": "SI", "celje": "SI",
  "копер": "SI", "koper": "SI",
  "крань": "SI", "kranj": "SI",
  // ME
  "подгорица": "ME", "podgorica": "ME",
  "будва": "ME", "budva": "ME",
  "kotor": "ME",
  "никшич": "ME", "niksic": "ME",
  "тиват": "ME", "tivat": "ME",
  // BG
  "пловдив": "BG", "plovdiv": "BG",
  "варна": "BG", "varna": "BG",
  "бургас": "BG", "burgas": "BG",
  "стара-загора": "BG", "стара загора": "BG", "stara zagora": "BG",
  // ES
  "барселона": "ES", "barcelona": "ES",
  "мадрид": "ES", "madrid": "ES",
  "валенсия": "ES", "valencia": "ES",
  "малага": "ES", "malaga": "ES",
  "севилья": "ES", "sevilla": "ES", "seville": "ES",
  "каталония": "ES", "catalonia": "ES", "catalunya": "ES",
  "андалусия": "ES", "andalusia": "ES",
  "бильбао": "ES", "bilbao": "ES",
  "сарагоса": "ES", "zaragoza": "ES",
  // RO
  "бухарест": "RO", "bucharest": "RO",
  "клуж": "RO", "cluj": "RO",
  "тимишоара": "RO", "timisoara": "RO",
  "яссы": "RO", "iasi": "RO",
  "трансильвания": "RO", "transylvania": "RO",
  "констанца": "RO", "constanta": "RO",
  // PL
  "варшава": "PL", "warsaw": "PL", "warszawa": "PL",
  "краков": "PL", "krakow": "PL", "cracow": "PL",
  "вроцлав": "PL", "wroclaw": "PL",
  "гданьск": "PL", "gdansk": "PL",
  "познань": "PL", "poznan": "PL",
  "лодзь": "PL", "lodz": "PL",
  "катовице": "PL", "katowice": "PL",
  // EE
  "таллин": "EE", "таллинн": "EE", "tallinn": "EE",
  "tartu": "EE",
  "нарва": "EE", "narva": "EE",
  // LT
  "вильнюс": "LT", "vilnius": "LT",
  "каунас": "LT", "kaunas": "LT",
  "клайпеда": "LT", "klaipeda": "LT",
  // CY
  "никосия": "CY", "nicosia": "CY",
  "лимасол": "CY", "limassol": "CY",
  "ларнака": "CY", "larnaca": "CY",
  "пафос": "CY", "paphos": "CY",
  // HU
  "будапешт": "HU", "budapest": "HU",
  "дебрецен": "HU", "debrecen": "HU",
  "сегед": "HU", "szeged": "HU",
  // MD
  "кишинёв": "MD", "кишинев": "MD", "chisinau": "MD",
  // BY
  "минск": "BY", "minsk": "BY",
  "гомель": "BY", "gomel": "BY",
  "витебск": "BY", "vitebsk": "BY",
  "гродно": "BY", "grodno": "BY",
  // TR
  "стамбул": "TR", "istanbul": "TR",
  "анкара": "TR", "ankara": "TR",
  "измир": "TR", "izmir": "TR",
  "анталия": "TR", "анталья": "TR", "antalya": "TR",
  "бодрум": "TR", "bodrum": "TR",
  // AZ
  "баку": "AZ", "baku": "AZ",
  "сумгаит": "AZ", "sumgait": "AZ",
  // AM
  "ереван": "AM", "yerevan": "AM",
  "гюмри": "AM", "gyumri": "AM",
  // GE
  "тбилиси": "GE", "tbilisi": "GE",
  "батуми": "GE", "batumi": "GE",
  "кутаиси": "GE", "kutaisi": "GE",
  // TJ
  "душанбе": "TJ", "dushanbe": "TJ",
  "худжанд": "TJ", "khujand": "TJ",
  // KG
  "бишкек": "KG", "bishkek": "KG",
  // MN
  "улан-батор": "MN", "ulaanbaatar": "MN",
  // NG
  "лагос": "NG", "lagos": "NG",
  "абуджа": "NG", "abuja": "NG",
  // MX
  "мехико": "MX", "mexico city": "MX",
  "гвадалахара": "MX", "guadalajara": "MX",
  "монтеррей": "MX", "monterrey": "MX",
  "канкун": "MX", "cancun": "MX",
  // ID
  "джакарта": "ID", "jakarta": "ID",
  "убуд": "ID", "ubud": "ID",
  "денпасар": "ID", "denpasar": "ID",
  "чангу": "ID", "canggu": "ID",
  "семиньяк": "ID", "seminyak": "ID",
  // RU
  "москва": "RU", "moscow": "RU",
  "санкт-петербург": "RU", "спб": "RU", "saint petersburg": "RU", "st petersburg": "RU",
  "казань": "RU", "kazan": "RU",
  "екатеринбург": "RU", "yekaterinburg": "RU",
  "новосибирск": "RU", "novosibirsk": "RU",
  "сочи": "RU", "sochi": "RU",
  // UA
  "киев": "UA", "kyiv": "UA", "kiev": "UA",
  "львов": "UA", "lviv": "UA",
  "одесса": "UA", "odesa": "UA", "odessa": "UA",
  "харьков": "UA", "kharkiv": "UA",
  // KZ
  "алматы": "KZ", "almaty": "KZ",
  "астана": "KZ", "astana": "KZ",
  "шымкент": "KZ", "shymkent": "KZ",
  // UZ
  "ташкент": "UZ", "tashkent": "UZ",
  "самарканд": "UZ", "samarkand": "UZ",
  "бухара": "UZ", "bukhara": "UZ",
  // AE
  "дубай": "AE", "dubai": "AE",
  "абу-даби": "AE", "abu dhabi": "AE",
  "шарджа": "AE", "sharjah": "AE",
  // IN
  "delhi": "IN",
  "мумбаи": "IN", "mumbai": "IN",
  "бангалор": "IN", "bangalore": "IN",
  "гоа": "IN",
  "хайдарабад": "IN", "hyderabad": "IN",
  // CH
  "цюрих": "CH", "zurich": "CH",
  "женева": "CH", "geneva": "CH",
  "базель": "CH", "basel": "CH",
  "лозанна": "CH", "lausanne": "CH",
};

/**
 * Страна по топониму в названии встречи. `null` — топонима нет ИЛИ их несколько из разных
 * стран («Барселона / Загреб»): угадывать, про какую из них созвон, нельзя.
 */
export function detectToponymCountry(title: string | null): string | null {
  const found = detectAliasCountries(title ?? "", TOPONYMS);
  return found.length === 1 ? found[0] : null;
}
