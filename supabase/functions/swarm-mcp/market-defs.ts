// Определения инструментов MCP — только данные, без обработчиков и клиента базы: тест аннотаций и tools/list
// грузят их, не втягивая в покрытие модули с логикой. Обработчики — в market.ts.

import { EDITORIAL_BLOCKS } from "../_shared/market/editorial.ts";

const ME = { type: "number", description: "Твой Telegram user ID" };
const CC = { type: "string", description: "Код страны, например BG, HR, RS" };
const SRC = { type: "string", description: "Источник: ссылка на документ или «внутренняя выгрузка Dodo». Обязателен" };
const str = (description: string) => ({ type: "string", description });
const numb = (description: string) => ({ type: "number", description });
const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties: { ...properties, requesting_user_id: ME },
  required: [...required, "requesting_user_id"],
});

export const MARKET_TOOL_DEFINITIONS = [
  {
    name: "market_template",
    description: "Шаблон отчёта «Анализ рынка»: разделы экрана, что собирается само, чем вносить руками, " +
      "форма каждого блока с примером. Читай перед заполнением страны.",
    inputSchema: schema({}, []),
  },
  {
    name: "market_status",
    description: "Что заполнено по стране: точки, деньги, цены, блоки ручной части, свежесть источников.",
    inputSchema: schema({ country: CC }, ["country"]),
  },
  {
    name: "market_get",
    description: "Что записано по стране сейчас. section: chains, locations (фильтры chain, city), money, prices " +
      "или имя блока ручной части (summary, events, ratings…). Перед правкой блока — прочитай его целиком.",
    inputSchema: schema({ country: CC, section: str("Раздел или блок"), chain: str("Ключ сети"), city: str("Город") }, [
      "country",
      "section",
    ]),
  },
  {
    name: "market_set_block",
    description: "Записать блок ручной части страны целиком (сводка, события, оценки, доставка, таблица пиццерий…). " +
      "Форма блока — в market_template. Блок заменяется полностью. Только админ.",
    inputSchema: schema({
      country: CC,
      block: str(`Блок: ${Object.keys(EDITORIAL_BLOCKS).join(", ")}`),
      payload: { description: "Содержимое блока: массив или объект по форме из шаблона" },
      source: SRC,
    }, ["country", "block", "payload", "source"]),
  },
  {
    name: "market_set_company_year",
    description: "Выручка юрлица за год (раздел «Деньги»). Валюта EUR или с фиксированным курсом (BGN, HRK) — " +
      "пересчёт в евро сделает Swarm. Прибыль не вносится. Только админ.",
    inputSchema: schema({
      country: CC,
      chain: str("Ключ сети, если юрлицо — оператор сети"),
      company: str("Юрлицо, как в реестре"),
      reg_id: str("Регистрационный номер (ЕИК, OIB, МБ…)"),
      year: numb("Год отчёта"),
      revenue: numb("Выручка от продаж, полной суммой (не в тысячах)"),
      currency: str("EUR, BGN или HRK"),
      employees: numb("Число сотрудников, если есть в отчёте"),
      source: SRC,
      note: str("Пометка: что именно за строка отчёта, консолидировано ли"),
    }, ["country", "company", "year", "revenue", "currency", "source"]),
  },
  {
    name: "market_upsert_location",
    description: "Точка на карте: без id — добавить новую (нужны chain, name, lat, lng), с id из market_get — " +
      "поправить или закрыть (closed = дата закрытия; статус без явного status не меняется). Сборщик OSM поправленную " +
      "руками точку не трогает. Пиццерии Dodo ведёт API Dodo — их дату открытия уточняй блоком location_dates. Только админ.",
    inputSchema: schema({
      country: CC,
      id: str("id точки из market_get — для правки"),
      chain: str("Ключ сети"),
      name: str("Название точки"),
      city: str("Город"),
      address: str("Адрес"),
      lat: numb("Широта"),
      lng: numb("Долгота"),
      opened: str("Дата открытия: ГГГГ, ГГГГ-ММ или ГГГГ-ММ-ДД"),
      status: str("open, closed, planned или paused"),
      closed: str("Дата закрытия"),
      source: SRC,
      note: str("Пометка проверки"),
    }, ["country", "source"]),
  },
  {
    name: "market_upsert_chain",
    description: "Завести сеть в стране или поправить её название и тип. Только админ.",
    inputSchema: schema({
      country: CC,
      key: str("Ключ сети латиницей: pizza-hut"),
      name: str("Название, как пишет сеть"),
      kind: str("pizza, bakery или other"),
      origin: str("Страна происхождения сети"),
      notes: str("Пометка"),
    }, ["country", "key", "name"]),
  },
  {
    name: "market_set_price",
    description: "Цена позиции меню сети на дату (раздел цен у пицца-сетей). Только админ.",
    inputSchema: schema({
      country: CC,
      chain: str("Ключ сети"),
      item: str("Позиция, например Margherita"),
      price: numb("Цена"),
      currency: str("EUR, BGN или HRK"),
      size_cm: numb("Размер пиццы, см"),
      channel: str("Канал: delivery, pickup, restaurant"),
      item_type: str("Тип позиции"),
      seen_on: str("Дата цены ГГГГ-ММ-ДД, по умолчанию сегодня"),
      source: SRC,
    }, ["country", "chain", "item", "price", "currency", "source"]),
  },
];
