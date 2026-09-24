// Словарь топонимов для контекста рекордера (issue #229): «Марибор» → SI.
// Главное здесь — НЕГАТИВНЫЕ кейсы: цена ложного срабатывания выше цены пустого блока,
// потому что в панель поедут тезисы чужого рынка, и человек им поверит.
import { assertEquals } from "jsr:@std/assert";
import { detectToponymCountry } from "./toponyms.ts";
import { contextCountry } from "./meeting-context.ts";

Deno.test("город и регион дают страну — повод issue #229", () => {
  assertEquals(detectToponymCountry("Созвон с Антоном про Марибор"), "SI");
  assertEquals(detectToponymCountry("Catalonia // Weekly sync"), "ES");
  assertEquals(detectToponymCountry("Пловдив: открытие"), "BG");
  assertEquals(detectToponymCountry("Zagreb team sync"), "HR");
});

Deno.test("кириллица склоняется — падежи ловятся, как у названий стран", () => {
  assertEquals(detectToponymCountry("Встреча по Мариборе"), "SI");
  assertEquals(detectToponymCountry("Планы Барселоны на квартал"), "ES");
  assertEquals(detectToponymCountry("Отчёт из Будапешта"), "HU");
});

Deno.test("несколько стран в топонимах — null, наугад не выбираем", () => {
  assertEquals(detectToponymCountry("Барселона / Загреб: обмен опытом"), null);
  assertEquals(detectToponymCountry("Belgrade + Sofia sync"), "RS"); // София не в словаре (имя) → одна страна
});

Deno.test("омонимы и имена НЕ дают страну — иначе в панель поедет чужой рынок", () => {
  // Каждый кейс — реальная ловушка, из-за которой топоним в словарь не попал.
  assertEquals(detectToponymCountry("Сплит-тест лендинга"), null);        // Split (HR)
  assertEquals(detectToponymCountry("Встреча, которой не было"), null);   // «котор» + «-ой»
  assertEquals(detectToponymCountry("Разбор с Софией"), null);            // София (BG) = имя
  assertEquals(detectToponymCountry("Бар: выручка за неделю"), null);     // Бар (ME)
  assertEquals(detectToponymCountry("Ниша для нового продукта"), null);   // Ниш (RS)
  assertEquals(detectToponymCountry("Победа над бэклогом"), null);
  assertEquals(detectToponymCountry("Tart and pastry supplier"), null);   // Тарту (EE)
  assertEquals(detectToponymCountry("Goal setting session"), null);       // Гоа (IN) латиницей
  assertEquals(detectToponymCountry("Bernard 1:1"), null);                // Берн (CH)
  assertEquals(detectToponymCountry("Call with Peter"), null);            // Питер (RU)
});

Deno.test("пусто и мусор — null, без исключений", () => {
  assertEquals(detectToponymCountry(null), null);
  assertEquals(detectToponymCountry(""), null);
  assertEquals(detectToponymCountry("   "), null);
});

Deno.test("contextCountry: страна в названии сильнее топонима", () => {
  // Явное указание страны имеет приоритет, топоним — только когда страны нет.
  assertEquals(contextCountry("Dodo Pizza Bulgaria"), "BG");
  assertEquals(contextCountry("Созвон про Марибор"), "SI");
  // Две страны в названии: детектор отдаёт ОДНУ (первое самое длинное совпадение),
  // топонимы в этом случае не зовутся вообще. Кросс-маркет не отсекается — issue #449.
  assertEquals(contextCountry("Сербия и Хорватия: встреча в Загребе"), "HR");
});
