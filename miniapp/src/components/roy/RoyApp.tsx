"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Me, Task } from "@/types";
import { TaskModal } from "@/components/TaskModal";
import { cn } from "@/lib/utils";
import { getDeepLinkMeetingId, getDeepLinkTaskId } from "@/lib/telegram";
import { fetchAgentMeetings, logout } from "@/lib/api";
import { OPEN_MEETING_EVENT } from "@/lib/single-tab";
import { RoyNavContext, useRoyNav, useDt, type RoyNav, type RoyRoute, type RoyTab } from "./nav";
import type { Lens, SmartListId } from "@/lib/smartLists";
import { RoyTabBar, NavHeader, RoyHeader, Avatar, ROY_TABS } from "./ui";
import { HeaderActions } from "./HeaderActions";
import { initials } from "./dash/shared";
import { useIsDesktop } from "./useIsDesktop";
import { SearchScreen } from "./screens/SearchScreen";
import { AnswerScreen } from "./screens/AnswerScreen";
import { RecordDetail } from "./screens/RecordDetail";
import { RoyTasksScreen } from "./screens/RoyTasksScreen";
import { RoyProjectsScreen } from "./screens/RoyProjectsScreen";
import { ProjectTasksScreen } from "./screens/ProjectTasksScreen";
import { TaskDetail } from "./screens/TaskDetail";
import { NewTask } from "./screens/NewTask";
import { RoyBaseScreen } from "./screens/RoyBaseScreen";
import { NewEntry } from "./screens/NewEntry";
import { RoyMeetingsScreen } from "./screens/RoyMeetingsScreen";
import { MeetingDetail } from "./screens/MeetingDetail";
import { RoyDashboard } from "./RoyDashboard";
import { FeedbackDialog, FeedbackFab } from "./FeedbackFab";
import { RoyMark } from "./RoyMark";
import { MeetingReview } from "@/components/MeetingReview";
import { TasksScreen } from "@/components/tasks/TasksScreen";
import { TeamScreen } from "@/components/TeamScreen";
import { SettingsScreen } from "@/components/SettingsScreen";
import { AdminScreen } from "@/components/AdminScreen";
import { MeetAdminScreen } from "./screens/MeetAdminScreen";
import { ProfileMenu } from "./ProfileMenu";
import { NotificationsBell } from "./NotificationsBell";
import { AnswerModal } from "./AnswerModal";

// Каркас «Рой»: корневые разделы + push-стек.
// МОБАЙЛ (решение владельца 2026-08-22, docs/decisions/2026-08-22-mobile-nav.md): нижний таб-бар
// «Задачи · Встречи · Ещё» (+ «Проекты» шагом 4), дом — задачи. Поиск не таб, а иконка в шапке
// любого корневого экрана → push-роут `ask` (тот же SearchScreen/AnswerScreen). База — пункт
// «Ещё» → push-роут `base`. Настройки/Команда/Админ/Карта живут в «Ещё» и потому доступны с
// ЛЮБОГО таба (до этого — только из шапки «Поиска», т.е. с одного экрана из четырёх).
// ДЕСКТОП (lg+) не менялся: дом — дашборд (`search`), «Задачи» — полный TasksScreen, база — `book`.

export function RoyApp({ me }: { me: Me | null }) {
  const [tab, setTabState] = useState<RoyTab>("search");
  const [stack, setStack] = useState<RoyRoute[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  // Единое окно-редактор задачи (открывается по клику откуда угодно) + ревизия для рефреша списков.
  const [taskModalTask, setTaskModalTask] = useState<Task | null>(null);
  const [tasksVersion, setTasksVersion] = useState(0);
  // Контекстное окно ответа (десктоп). На мобайле openAnswer уходит в push (см. ниже).
  const [answerQuery, setAnswerQuery] = useState<string | null>(null);
  // Стартовая линза доски задач при входе из панелей дашборда (Мои/Команда). null = дефолт.
  const [taskView, setTaskView] = useState<{ lens: Lens; list?: SmartListId } | null>(null);
  const openTask = useCallback((t: Task) => setTaskModalTask(t), []);
  const isDesktop = useIsDesktop();
  // Сколько черновиков встреч ждёт вычитки — для бейджа на табе «Встречи». Ошибку глотаем:
  // эндпоинт /agent-meetings может быть недоступен, и это не повод ронять каркас (та же
  // намеренная деградация, что в AgentReviewQueue).
  const [reviewCount, setReviewCount] = useState(0);
  // Стек восстановлен из sessionStorage? До этого не персистим, иначе начальный [] затрёт сохранённый.
  const hydrated = useRef(false);

  const setTab = useCallback((t: RoyTab) => {
    setTaskView(null);   // обычный переход по табу → доска задач с дефолтной линзой
    setStack([]);
    setTabState(t);
    // Запоминаем вкладку, чтобы рефреш страницы не сбрасывал на «Поиск».
    try { sessionStorage.setItem("roy_tab", t); } catch { /* приватный режим */ }
  }, []);
  // Открыть доску задач с заданной линзой (из панелей «Мои»/«Команда» дашборда).
  const openTasks = useCallback((lens: Lens, list?: SmartListId) => {
    setTaskView({ lens, list });
    setStack([]);
    setTabState("task");
    try { sessionStorage.setItem("roy_tab", "task"); } catch { /* приватный режим */ }
  }, []);
  const push = useCallback((r: RoyRoute) => setStack((s) => [...s, r]), []);
  // Десктоп — ответ контекстным окном поверх дашборда; мобайл — полноэкранный push.
  const openAnswer = useCallback((query: string) => {
    if (isDesktop) setAnswerQuery(query);
    else setStack((s) => [...s, { view: "answer", params: { query } }]);
  }, [isDesktop]);
  const pop = useCallback(() => {
    setStack((s) => s.slice(0, -1));
    // deep-link встречи приходит как ?meeting= — чистим, чтобы назад не открывал её снова
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  const toast = useCallback((msg: string) => setToastMsg(msg), []);

  // Открыть вычитку встречи в этом инстансе: вкладка Встречи + push вычитки.
  // Дёргается и из начального deep-link, и по событию roy:open-meeting (когда встречу
  // передала другая вкладка/лаунч PWA — см. lib/single-tab.ts).
  const openMeeting = useCallback((id: string) => {
    setTabState("cal");
    setStack([{ view: "meetingReview", params: { id } }]);
  }, []);

  // Бейдж «на вычитке»: считаем при монтировании и при каждой смене таба на «Встречи»
  // (разобрал очередь → вернулся на другой таб → счётчик обновится при следующем заходе).
  useEffect(() => {
    let alive = true;
    fetchAgentMeetings("awaiting_review")
      .then((list) => { if (alive) setReviewCount(list.length); })
      .catch(() => { if (alive) setReviewCount(0); });
    return () => { alive = false; };
  }, [tab, stack.length]);

  useEffect(() => {
    if (!toastMsg) return;
    const id = setTimeout(() => setToastMsg(null), 1900);
    return () => clearTimeout(id);
  }, [toastMsg]);

  // Deep-link из уведомления «тезисы готовы» → открыть вычитку.
  // Иначе — восстанавливаем последнюю вкладку (рефреш не должен кидать на «Поиск»).
  useEffect(() => {
    const id = getDeepLinkMeetingId();
    if (id) {
      openMeeting(id);
      hydrated.current = true;
      return;
    }
    // Deep-link из пуша о комментарии → сразу карточка задачи.
    const taskId = getDeepLinkTaskId();
    if (taskId) {
      setTabState("task");
      setStack([{ view: "taskDetail", params: { id: taskId } }]);
      hydrated.current = true;
      return;
    }
    try {
      const saved = sessionStorage.getItem("roy_tab");
      // Валидируем по ПОЛНОМУ союзу, а не по ROY_TABS: в баре мобильные табы, а `search`/`book` —
      // десктопные разделы. На мобайле сохранённые десктопные значения мигрируем, иначе человек с
      // живой сессией после деплоя попал бы на экран, которого в баре нет (подсветки таба нет).
      const valid = saved && (["search", "task", "projects", "book", "cal", "more"] as const).includes(saved as RoyTab)
        ? (saved as RoyTab)
        : null;
      const desktop = window.matchMedia("(min-width: 1024px)").matches;
      const initial: RoyTab = desktop
        ? (valid ?? "search")
        : valid === null || valid === "search" ? "task" : valid === "book" ? "more" : valid;
      setTabState(initial);
      // Восстанавливаем и push-стек (открытую деталь), чтобы рефреш не сбрасывал на корень таба.
      // Валидируем не только view, но и ОБЯЗАТЕЛЬНЫЕ params (битый/усечённый storage → роут без id
      // ушёл бы в fetch(undefined) и белый экран). Любой невалидный роут → стек не восстанавливаем.
      const rawStack = sessionStorage.getItem("roy_stack");
      if (rawStack) {
        const parsed = JSON.parse(rawStack);
        const needsId = new Set(["record", "taskDetail", "meetingDetail", "meetingReview", "project"]);
        const valid = (r: { view?: unknown; params?: { id?: unknown; query?: unknown } }) => {
          if (!r || typeof r.view !== "string") return false;
          if (r.view === "answer") return typeof r.params?.query === "string";
          if (needsId.has(r.view)) return typeof r.params?.id === "string" && r.params.id.length > 0;
          return true;
        };
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(valid)) {
          setStack(parsed as RoyRoute[]);
        }
      }
    } catch { /* приватный режим / битый JSON — стартуем с корня */ }
    hydrated.current = true;
  }, [openMeeting]);

  // Персист push-стека рядом с roy_tab: после рефреша остаёмся на текущей детали.
  // (Если восстановленная деталь по id уже удалена — её экран мягко покажет ошибку загрузки.)
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      if (stack.length) sessionStorage.setItem("roy_stack", JSON.stringify(stack));
      else sessionStorage.removeItem("roy_stack");
    } catch { /* приватный режим */ }
  }, [stack]);

  // Встреча, переданная из другой вкладки (дедуп) или из лаунча установленного PWA.
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) openMeeting(id);
    };
    window.addEventListener(OPEN_MEETING_EVENT, handler);
    return () => window.removeEventListener(OPEN_MEETING_EVENT, handler);
  }, [openMeeting]);

  const nav: RoyNav = { me, tab, setTab, push, pop, toast, openTask, openAnswer, tasksVersion, bumpTasks: () => setTasksVersion((v) => v + 1), taskView, openTasks };
  const top = stack[stack.length - 1];
  // На десктопе домашняя вкладка («Поиск») — бенто-дашборд во всю ширину; на мобайле и в
  // push-стеке остаётся центрированная колонка.
  const isDashboard = isDesktop && tab === "search" && !top;

  return (
    <RoyNavContext.Provider value={nav}>
      <div className="flex flex-col h-[100dvh] bg-background text-foreground dark:bg-transparent">
        {me?.is_demo && (
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary px-4 py-1.5 text-white" style={{ fontSize: 13 }}>
            <span className="font-semibold">🎬 Demo mode</span>
            <span className="hidden opacity-90 sm:inline">— a Swarm Brain showcase, not a real workspace</span>
            <button
              type="button"
              onClick={async () => { try { await logout(); } finally { window.location.href = "/login"; } }}
              className="rounded-full bg-white/20 px-3 py-0.5 font-semibold transition-colors hover:bg-white/30"
            >
              Exit demo
            </button>
          </div>
        )}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className={cn(
              "relative mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden",
              // Тёмная тема: лёгкая вуаль БЕЗ blur — галактика видна в щелях между панелями
              // (не размыта). Frost/стекло — на самих карточках (RoyCard). Читаемость голого
              // текста подстрахована вуалью + приглушённой галактикой.
              "dark:bg-[#0a0b07]/22",
              // Десктоп — единая оптимальная ширина с авто-полями по краям (во всю ширину
              // получалось «дерьмо»: строки/текст растягивались на весь монитор). Мобайл — узкая колонка.
              isDashboard ? "max-w-[1280px]" : "max-w-[480px] lg:max-w-[1280px]",
            )}
          >
            {top ? (
              <PushScreen route={top} />
            ) : (
              <>
                {/* Desktop dashboard-центрично: сайдбара нет, дашборд — дом. На секции
                    (Задачи/База/Встречи) ведут шапки панелей дашборда; назад на дашборд —
                    эта строка. Push-экраны имеют свой «Назад». Мобайл — нижний таб-бар. */}
                {isDesktop && tab !== "search" && (
                  <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-2">
                    <button
                      type="button"
                      onClick={() => setTab("search")}
                      className="flex items-center gap-2 py-0.5 text-left font-semibold text-ink-soft transition-colors hover:text-ink"
                    >
                      <RoyMark size={22} />
                      <span style={{ fontSize: 14 }}>← Главная</span>
                    </button>
                    <NotificationsBell />
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-hidden">
                  {tab === "search" && (isDashboard ? <RoyDashboard /> : <SearchScreen />)}
                  {tab === "task" && (isDesktop ? <TasksScreen /> : <RoyTasksScreen />)}
                  {/* Десктоп своей доской проектов уже владеет (TasksScreen → вид «Проекты»),
                      мобильный экран — отдельный: список проектов → задачи внутри. */}
                  {tab === "projects" && (isDesktop ? <TasksScreen /> : <RoyProjectsScreen />)}
                  {tab === "book" && <RoyBaseScreen />}
                  {tab === "cal" && <RoyMeetingsScreen />}
                  {tab === "more" && <MoreScreen root />}
                </div>
                <RoyTabBar active={tab} onChange={(id) => setTab(id as RoyTab)} className="lg:hidden" badges={{ cal: reviewCount }} />
              </>
            )}

            {toastMsg && (
              <div
                role="status"
                className="roy-pop absolute bottom-[110px] left-1/2 z-50 -translate-x-1/2 rounded-[13px] bg-ink px-4 py-2.5 text-sm text-surface shadow-[0_10px_30px_rgba(0,0,0,.3)]"
              >
                {toastMsg}
              </div>
            )}
          </div>
          {/* Профиль/управление — внизу слева (desktop, вместо сайдбара): нативный поповер
              в углу с inline-секциями Настройки/Команда/Админ, без перехода на страницу.
              На мобайле — аватар в шапке + таб-бар. */}
          {isDesktop && <ProfileMenu />}
        </div>
        </div>
      </div>

      {/* Единое окно-редактор задачи — рендерится один раз в корне, открывается openTask() из
          любого места. onSaved бампает tasksVersion → списки задач перезапрашиваются. */}
      <TaskModal
        task={taskModalTask ?? undefined}
        open={taskModalTask !== null}
        onClose={() => setTaskModalTask(null)}
        onSaved={() => setTasksVersion((v) => v + 1)}
      />
      {answerQuery !== null && <AnswerModal query={answerQuery} onClose={() => setAnswerQuery(null)} />}
      {/* На мобайле «?» была вторым FAB под «+» и спорила с главным действием экрана —
          фидбек переехал пунктом в «Ещё» (аудит мобилки 2026-08-22). */}
      {isDesktop && <FeedbackFab />}
    </RoyNavContext.Provider>
  );
}

function PushScreen({ route }: { route: RoyRoute }) {
  if (route.view === "meetingReview") return <MeetingReviewScreen id={route.params.id} />;
  if (route.view === "answer") return <AnswerScreen query={route.params.query} />;
  if (route.view === "record") return <RecordDetail id={route.params.id} />;
  if (route.view === "taskDetail") return <TaskDetail id={route.params.id} />;
  if (route.view === "newTask") return <NewTask id={route.params?.id} />;
  if (route.view === "newEntry") return <NewEntry />;
  if (route.view === "meetingDetail") return <MeetingDetail id={route.params.id} />;
  if (route.view === "more") return <MoreScreen />;
  if (route.view === "ask") return <AskScreen />;
  if (route.view === "base") return <BaseScreen />;
  if (route.view === "project") return <ProjectTasksScreen id={route.params.id} />;
  if (route.view === "map") return <MapScreen />;
  if (route.view === "settings") return <Wrapped title="Настройки"><SettingsScreen /></Wrapped>;
  if (route.view === "team") return <Wrapped title="Команда"><TeamScreen /></Wrapped>;
  if (route.view === "admin") return <Wrapped title="Админ"><AdminScreen /></Wrapped>;
  if (route.view === "meetAdmin") return <MeetAdminScreen initialMode={route.params?.mode} />;
  return null;
}

function MeetingReviewScreen({ id }: { id: string }) {
  const { pop } = useRoyNav();
  return <MeetingReview id={id} onClose={pop} />;
}

// Интерактивная карта системы — самодостаточный HTML (canvas) в public/system-map.html,
// встраиваем как iframe (своя физика/зум/пан внутри). Отдаётся Cloudflare Pages по /system-map.html.
function MapScreen() {
  const { pop } = useRoyNav();
  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title="Карта системы" />
      <iframe
        src="/system-map.html"
        title="Карта системы Swarm Brain"
        className="min-h-0 w-full flex-1 border-0 bg-[#0a0b07]"
      />
    </div>
  );
}

// Поиск как push-экран: таба «Поиск» на мобайле нет, вход — иконка в шапке (SearchBtn).
// Тот же SearchScreen (поле, недавние запросы, «Продолжить»), только с «Назад» вместо лого.
function AskScreen() {
  const { pop } = useRoyNav();
  return <SearchScreen onBack={pop} />;
}

// База как push-экран из «Ещё» — тот же RoyBaseScreen, с «Назад» вместо заголовка-хедера.
function BaseScreen() {
  const { pop } = useRoyNav();
  return <RoyBaseScreen onBack={pop} />;
}

function Wrapped({ title, children }: { title: string; children: React.ReactNode }) {
  const { pop } = useRoyNav();
  return (
    <div className="roy-pop flex h-full flex-col">
      <NavHeader onBack={pop} title={title} />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

// «Ещё» — корневой таб на мобайле (root) и push-экран на десктопе (из шапки дашборда).
// Здесь живёт всё, что не заслужило таба: профиль, база, команда, настройки, админка, карта.
// Именно это закрывает главный блокер навигации — раньше вход был только из шапки «Поиска».
function MoreScreen({ root = false }: { root?: boolean }) {
  const { me, push, pop } = useRoyNav();
  const dt = useDt();
  const [feedback, setFeedback] = useState(false);
  const rows: { label: string; route: RoyRoute }[] = [
    { label: dt("База", "Knowledge base"), route: { view: "base" } },
    { label: dt("Команда", "Team"), route: { view: "team" } },
    { label: dt("Настройки", "Settings"), route: { view: "settings" } },
    { label: dt("Карта системы", "System map"), route: { view: "map" } },
  ];
  if (me?.is_admin) rows.push({ label: dt("Админ", "Admin"), route: { view: "admin" } });
  return (
    <div className="roy-pop flex h-full flex-col">
      {root ? <RoyHeader title={dt("Ещё", "More")} right={<HeaderActions />} /> : <NavHeader onBack={pop} title={dt("Ещё", "More")} />}
      {me && (
        <div className="flex shrink-0 items-center gap-3 px-4 pb-3">
          <Avatar size={44}>{initials(me.name)}</Avatar>
          <div className="min-w-0">
            <div className="truncate font-semibold text-ink" style={{ fontSize: 15 }}>{me.name}</div>
            {me.username && <div className="truncate text-ink-mute" style={{ fontSize: 13 }}>@{me.username}</div>}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
        {rows.map((r) => (
          <button
            key={r.label}
            type="button"
            onClick={() => push(r.route)}
            className="flex w-full items-center justify-between rounded-[18px] border border-line bg-surface px-4 py-3.5 text-left font-semibold text-ink transition-transform active:scale-[0.98]"
            style={{ fontSize: 15 }}
          >
            {r.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setFeedback(true)}
          className="flex w-full items-center justify-between rounded-[18px] border border-line bg-surface px-4 py-3.5 text-left font-semibold text-ink transition-transform active:scale-[0.98]"
          style={{ fontSize: 15 }}
        >
          {dt("Оставить фидбек", "Send feedback")}
        </button>
        <FeedbackDialog open={feedback} onOpenChange={setFeedback} />
      </div>
    </div>
  );
}
