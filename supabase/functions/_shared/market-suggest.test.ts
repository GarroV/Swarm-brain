// Тесты подсказки рынков для экрана вычитки (issue #73).
// Запуск: deno test supabase/functions/_shared/market-suggest.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pickSuggestedMarkets } from "./market-suggest.ts";

Deno.test("название встречи — решающий сигнал", () => {
  assertEquals(
    pickSuggestedMarkets({ title: "Dodo Pizza Bulgaria", participantMarkets: [["RS"]], notesMarkets: ["RS"] }),
    { markets: ["BG"], source: "title" },
  );
  assertEquals(
    pickSuggestedMarkets({ title: "Wolt Bulgaria with Georgi Mihaylov", participantMarkets: [], notesMarkets: [] }),
    { markets: ["BG"], source: "title" },
  );
});

Deno.test("без страны в названии — пересечение рынков участников", () => {
  assertEquals(
    pickSuggestedMarkets({ title: "Weekly sync", participantMarkets: [["BG"], ["RS", "BG", "HR"]], notesMarkets: [] }),
    { markets: ["BG"], source: "participants" },
  );
});

Deno.test("участники без общего рынка — не выдумываем, идём к тезисам", () => {
  assertEquals(
    pickSuggestedMarkets({ title: "Weekly sync", participantMarkets: [["BG"], ["RS"]], notesMarkets: ["Serbia"] }),
    { markets: ["RS"], source: "notes" },
  );
});

Deno.test("шумное пересечение (3+ рынка) не предлагается — это кросс-маркет", () => {
  assertEquals(
    pickSuggestedMarkets({ title: "HQ review", participantMarkets: [["RS", "BG", "HR", "SI"]], notesMarkets: [] }),
    { markets: [], source: null },
  );
});

Deno.test("сигналов нет — пусто (Общее), а не угаданный рынок", () => {
  assertEquals(
    pickSuggestedMarkets({ title: "1-1", participantMarkets: [], notesMarkets: [] }),
    { markets: [], source: null },
  );
});

Deno.test("тезисы нормализуются в ISO; два и больше рынков — кросс-маркет, не предлагаем (issue #167)", () => {
  assertEquals(
    pickSuggestedMarkets({ title: null, participantMarkets: [], notesMarkets: ["Bulgaria"] }),
    { markets: ["BG"], source: "notes" },
  );
  assertEquals(
    pickSuggestedMarkets({ title: null, participantMarkets: [], notesMarkets: ["Хорватия"] }),
    { markets: ["HR"], source: "notes" },
  );
  // Живой случай 26.08: у встречи «IT+BD» классификатор по тезисам дал два рынка, они уехали
  // в базу как ['RS','BG'] и запись попала в дайджест обеих стран. Порог канона — 1.
  assertEquals(
    pickSuggestedMarkets({ title: null, participantMarkets: [], notesMarkets: ["Serbia", "Bulgaria"] }),
    { markets: [], source: null },
  );
  assertEquals(
    pickSuggestedMarkets({ title: null, participantMarkets: [], notesMarkets: ["Bulgaria", "Croatia", "Serbia"] }),
    { markets: [], source: null },
  );
});

Deno.test("пересечение участников из двух рынков тоже не предлагается (порог 1)", () => {
  assertEquals(
    pickSuggestedMarkets({ title: "Weekly sync", participantMarkets: [["RS", "BG"], ["RS", "BG", "HR"]], notesMarkets: [] }),
    { markets: [], source: null },
  );
});

Deno.test("General из классификатора — это не рынок", () => {
  assertEquals(
    pickSuggestedMarkets({ title: null, participantMarkets: [], notesMarkets: ["General"] }),
    { markets: [], source: null },
  );
});
