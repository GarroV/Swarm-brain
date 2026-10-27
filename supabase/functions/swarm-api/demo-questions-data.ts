// Каталог заготовленных вопросов демо — вместо свободного «спросить базу» (решение владельца
// 27.10.2026, docs/decisions/2026-10-27-demo-no-model.md). Ответы написаны руками по записям,
// которые засевает `public.demo_reset()` (миграция 20260928180000_demo_auto_reset.sql): id записей
// там фиксированные, поэтому после каждого сброса демо источники те же. Правка эталона демо —
// правка этого файла; расхождение ловит demo-questions.test.ts (id и заголовок обязаны быть в сиде).
//
// Демо рендерится по-английски (docs/decisions/2026-09-23-english-only-for-demo.md), но каждая
// строка заведена и по-русски (`ru`) — как и у остальных строк продукта.

export type DemoSource = {
  /** Фиксированный id записи в сиде демо. */
  id: string;
  /** metadata.title записи в сиде — по нему тест сверяет каталог с эталоном. */
  title: string;
  tag: "meet" | "note";
  entry_type: "meeting" | "note";
  market: string | null;
  /** Смещение даты записи от сегодня в сиде (`current_date - N`). */
  daysAgo: number;
  snippet: { en: string; ru: string };
};

export type DemoQuestion = {
  id: string;
  question: { en: string; ru: string };
  /** Текст со сносками [n] — n это позиция в `sources`, начиная с 1. */
  answer: { en: string; ru: string };
  sources: DemoSource[];
  /** id вопросов-продолжений (показываются чипами под ответом). */
  followups: string[];
};

const S = {
  ops: {
    id: "d0000000-0000-4000-8000-000000000501", title: "Weekly ops sync", tag: "meet", entry_type: "meeting",
    market: "PT", daysAgo: 2,
    snippet: {
      en: "Peak-hour ticket time is 6–7 minutes at Harbour Street, target is under 4. Milk steaming is the bottleneck.",
      ru: "В час пик чек делается 6–7 минут при цели меньше 4. Узкое место — взбивание молока.",
    },
  },
  release: {
    id: "d0000000-0000-4000-8000-000000000502", title: "App release review", tag: "meet", entry_type: "meeting",
    market: null, daysAgo: 1,
    snippet: {
      en: "One-tap reorder: iOS done, Android in review. Release on Monday if refund tests pass.",
      ru: "Повтор заказа в один тап: iOS готов, Android на проверке. Релиз в понедельник, если пройдут тесты возвратов.",
    },
  },
  menu: {
    id: "d0000000-0000-4000-8000-000000000503", title: "Autumn menu kick-off", tag: "meet", entry_type: "meeting",
    market: "NL", daysAgo: 4,
    snippet: {
      en: "Four seasonal drinks, two pastries. Prices agreed; launch NL and DE first, other markets a week later.",
      ru: "Четыре сезонных напитка и две выпечки. Цены согласованы; запуск сначала в NL и DE, остальные рынки неделей позже.",
    },
  },
  dairy: {
    id: "d0000000-0000-4000-8000-000000000504", title: "Dairy supplier call", tag: "meet", entry_type: "meeting",
    market: "ES", daysAgo: 6,
    snippet: {
      en: "Early-morning deliveries from next month, same price. Quarterly quality reports received.",
      ru: "Доставки рано утром со следующего месяца, по той же цене. Квартальные отчёты о качестве получены.",
    },
  },
  playbook: {
    id: "d0000000-0000-4000-8000-000000000511", title: "Store opening playbook", tag: "note", entry_type: "note",
    market: null, daysAgo: 12,
    snippet: {
      en: "Lease, permits and fit-out; equipment order 6 weeks before opening; hire and train the team 3 weeks before.",
      ru: "Аренда, разрешения и отделка; заказ оборудования за 6 недель до открытия; найм и обучение команды за 3 недели.",
    },
  },
  layout: {
    id: "d0000000-0000-4000-8000-000000000512", title: "Peak-hour station layout", tag: "note", entry_type: "note",
    market: "PT", daysAgo: 9,
    snippet: {
      en: "Till, espresso, milk + hand-off — three stations. Milk fridge within one step of the steam wand.",
      ru: "Касса, эспрессо, молоко и выдача — три станции. Холодильник с молоком в одном шаге от парового крана.",
    },
  },
  voice: {
    id: "d0000000-0000-4000-8000-000000000513", title: "Brand voice guide", tag: "note", entry_type: "note",
    market: null, daysAgo: 20,
    snippet: {
      en: "Warm, short, neighbourly. Talk like the barista who knows your order.",
      ru: "Тёплый, короткий, по-соседски. Говорим как бариста, который знает ваш заказ.",
    },
  },
} as const satisfies Record<string, DemoSource>;

export const DEMO_QUESTIONS: readonly DemoQuestion[] = [
  {
    id: "release",
    question: { en: "What was decided about the app release?", ru: "Что решили по релизу приложения?" },
    answer: {
      en:
        "- The release goes out on Monday if the refund tests pass [1].\n- One-tap reorder is done on iOS; Android is one day behind [1].\n- Two refund cases still fail on the test card and are open with the provider [1].\n- The stores get short release notes before launch day [1].",
      ru:
        "- Релиз выходит в понедельник, если пройдут тесты возвратов [1].\n- Повтор заказа в один тап готов на iOS; Android отстаёт на день [1].\n- Два случая возврата на тестовой карте пока падают, вопрос открыт у провайдера [1].\n- Магазины получат короткие заметки о релизе до дня запуска [1].",
    },
    sources: [S.release],
    followups: ["peak-hour", "this-week"],
  },
  {
    id: "peak-hour",
    question: { en: "Why is service slow at peak hour and what is the fix?", ru: "Почему в час пик обслуживание медленное и что делаем?" },
    answer: {
      en:
        "- Ticket time at Harbour Street is 6–7 minutes at peak against a target of under 4; milk steaming is the bottleneck [1].\n- First fix: move the milk fridge next to the bar [1].\n- The station layout note sets three stations (till, espresso, milk and hand-off), the fridge within one step of the steam wand, and cups pre-stacked by size before 8:00 [2].",
      ru:
        "- На Harbour Street чек в час пик делается 6–7 минут при цели меньше 4; узкое место — взбивание молока [1].\n- Первое исправление: переставить холодильник с молоком к бару [1].\n- Заметка о раскладке станций: три станции (касса, эспрессо, молоко и выдача), холодильник в одном шаге от парового крана, стаканы разложены по размеру до 8:00 [2].",
    },
    sources: [S.ops, S.layout],
    followups: ["dairy", "new-store"],
  },
  {
    id: "autumn-menu",
    question: { en: "What is the plan for the autumn menu launch?", ru: "Какой план запуска осеннего меню?" },
    answer: {
      en:
        "- The menu has four seasonal drinks and two pastries; prices are agreed [1].\n- Launch in NL and DE first, the other markets a week later [1].\n- The photo shoot is booked and the menu boards go to print on Thursday; in-store posters still need a designer [1].\n- Copy follows the brand voice: warm, short, neighbourly, no exclamation marks next to prices [2].",
      ru:
        "- В меню четыре сезонных напитка и две выпечки; цены согласованы [1].\n- Запуск сначала в NL и DE, остальные рынки неделей позже [1].\n- Фотосессия назначена, меню-борды уходят в печать в четверг; постерам для магазинов всё ещё нужен дизайнер [1].\n- Тексты — в голосе бренда: тёплые, короткие, по-соседски, без восклицательных знаков рядом с ценами [2].",
    },
    sources: [S.menu, S.voice],
    followups: ["this-week", "release"],
  },
  {
    id: "dairy",
    question: { en: "What did the dairy supplier offer?", ru: "Что предложил поставщик молока?" },
    answer: {
      en:
        "- Deliveries before 7:00 from next month at the same price [1].\n- Quarterly quality reports are received and attached to the audit; a plant visit is to be booked [1].\n- The ops sync noted the same ask from the supplier: move deliveries to early morning [2].",
      ru:
        "- Доставки до 7:00 со следующего месяца по той же цене [1].\n- Квартальные отчёты о качестве получены и приложены к аудиту; визит на завод нужно назначить [1].\n- На ops-синке отмечена та же просьба поставщика: перенести доставки на раннее утро [2].",
    },
    sources: [S.dairy, S.ops],
    followups: ["peak-hour", "new-store"],
  },
  {
    id: "new-store",
    question: { en: "How do we open a new store?", ru: "Как мы открываем новый магазин?" },
    answer: {
      en:
        "- The playbook: lease, permits and fit-out; order equipment 6 weeks before opening; hire and train the team 3 weeks before; soft opening for neighbours, then the opening weekend; first-month review with the numbers [1].\n- Store #7 is on this path: the lease is signed and hiring starts this week [2].",
      ru:
        "- Плейбук: аренда, разрешения и отделка; заказ оборудования за 6 недель до открытия; найм и обучение команды за 3 недели; мягкое открытие для соседей, затем открытие на выходных; разбор первого месяца по цифрам [1].\n- Магазин №7 идёт по этому пути: аренда подписана, найм начинается на этой неделе [2].",
    },
    sources: [S.playbook, S.ops],
    followups: ["peak-hour", "dairy"],
  },
  {
    id: "this-week",
    question: { en: "What happened in the meetings this week?", ru: "Что было на встречах на этой неделе?" },
    answer: {
      en:
        "- Weekly ops sync: peak-hour service speed, dairy delivery windows, store #7 lease signed [1].\n- App release review: release on Monday if the refund tests pass [2].\n- Autumn menu kick-off: launch in NL and DE first, menu boards to print on Thursday [3].\n- Dairy supplier call: early-morning deliveries from next month at the same price [4].",
      ru:
        "- Weekly ops sync: скорость обслуживания в час пик, окна доставки молока, аренда магазина №7 подписана [1].\n- App release review: релиз в понедельник, если пройдут тесты возвратов [2].\n- Autumn menu kick-off: запуск сначала в NL и DE, меню-борды в печать в четверг [3].\n- Dairy supplier call: доставки рано утром со следующего месяца по той же цене [4].",
    },
    sources: [S.ops, S.release, S.menu, S.dairy],
    followups: ["release", "autumn-menu"],
  },
];

/** Подготовленный дайджест главной (вместо модели): записи рынков демо-пользователя (PT, ES). */
export const DEMO_DIGEST: { text: { en: string; ru: string }; sources: DemoSource[] } = {
  text: {
    en:
      "### Portugal\n- Peak-hour ticket time at Harbour Street is 6–7 minutes against a target of under 4; moving the milk fridge next to the bar is the first fix [1].\n- Station layout for peak hours: three stations, cups pre-stacked by size before 8:00 [2].\n### Spain\n- The dairy supplier can deliver before 7:00 from next month at the same price; a plant visit is to be booked [3].",
    ru:
      "### Португалия\n- Чек на Harbour Street в час пик делается 6–7 минут при цели меньше 4; первое исправление — переставить холодильник с молоком к бару [1].\n- Раскладка станций на пик: три станции, стаканы разложены по размеру до 8:00 [2].\n### Испания\n- Поставщик молока может возить до 7:00 со следующего месяца по той же цене; визит на завод нужно назначить [3].",
  },
  sources: [S.ops, S.layout, S.dairy],
};
