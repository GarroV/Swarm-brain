"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import type { Task, TaskLink, Person, Project } from "@/types";
import { TaskModalProperties, TaskHydrationNotice, TaskDescription, TaskOrigin, fieldCls, labelCls } from "@/components/tasks/taskModalPresentation";
import { useCardSections } from "@/components/tasks/useCardSections";
import { displayName } from "@/lib/utils";
import {
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskLabel,
  createTask,
  updateTask,
  deleteTask,
  fetchPeople,
  createPerson,
  fetchTaskLabels,
  fetchConfig,
  fetchProjects,
  fetchMe,
  fetchTask,
} from "@/lib/api";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { TaskComments } from "@/components/tasks/TaskComments";
import { COUNTRY_NAMES, parseCountryList, taskCountryCodes } from "@/lib/countries";
import { useDt } from "@/components/roy/nav";
import { useIsDesktop } from "@/components/roy/useIsDesktop";
import { recurValueOf, type RecurValue } from "@/lib/recurrenceLabels";
import { hasOpenEscapeLayer } from "@/lib/escapeLayer";
import { buildProjectOptions } from "@/lib/projectPicker";
import { isRawId } from "@/lib/displayFormat";

// Функционал ролей пока не используется командой — поле скрыто в UI, но не удалено
// (данные task_role продолжают сохраняться на уже размеченных задачах).
const SHOW_TASK_ROLE = false;

const TASK_ROLES = [
  { value: "marketing", label: "Marketing" },
  { value: "bd", label: "BD" },
  { value: "rnd", label: "R&D" },
];
const TASK_MODAL_COPY = {
  deleteTask: { ru: "Удалить задачу", en: "Delete task" },
  close: { ru: "Закрыть", en: "Close" },
  role: { ru: "Роль", en: "Role" },
  cancel: { ru: "Отмена", en: "Cancel" },
  done: { ru: "Готово", en: "Done" },
  creating: { ru: "Создание…", en: "Creating…" },
  create: { ru: "Создать", en: "Create" },
  loadError: { ru: "Не загрузилось", en: "Could not load" },
  loading: { ru: "Загружаем…", en: "Loading…" },
  titleRequired: { ru: "Нужно название", en: "Title required" },
  saving: { ru: "Сохранение…", en: "Saving…" },
  saveError: { ru: "Не сохранилось", en: "Not saved" },
  saved: { ru: "Сохранено", en: "Saved" },
  createError: { ru: "Не удалось создать", en: "Could not create task" },
  deleteError: { ru: "Не удалось удалить", en: "Could not delete task" },
  deleteAction: { ru: "Удалить", en: "Delete" },
} as const;
const normStatus = (s?: string | null) => (s === "progress" ? "in_progress" : (s ?? "open"));

// Исполнитель без входа в Swarm хранится в форме токеном «p:<person id>» (#874).
const PERSON_TOKEN = "p:";

function assigneeTokenOf(task: Task | null | undefined): string {
  const tg = task?.assignee_telegram_ids?.[0];
  if (tg != null) return tg.toString();
  return task?.assignee_person_id ? PERSON_TOKEN + task.assignee_person_id : NONE;
}

function prefillAssigneeToken(prefill: TaskModalProps["prefill"]): string {
  if (prefill?.assignee_telegram_id != null) return prefill.assignee_telegram_id.toString();
  return prefill?.assignee_person_id ? PERSON_TOKEN + prefill.assignee_person_id : NONE;
}

// Токен исполнителя → поля запроса: аккаунт — по-старому, человек без входа — assignee_person_id.
function assigneeFields(token: string): { assignee_telegram_id?: number | null; assignee_person_id?: string } {
  if (token === NONE) return { assignee_telegram_id: null };
  if (token.startsWith(PERSON_TOKEN)) return { assignee_person_id: token.slice(PERSON_TOKEN.length) };
  return { assignee_telegram_id: parseInt(token, 10) };
}

// Sentinel for the assignee/role selects — empty string is not a valid select value
const NONE = "__none__";

// Автосохранение правок (edit-режим): debounce после остановки ввода — кнопки «Сохранить» нет.
const AUTOSAVE_DELAY = 550;

interface TaskModalProps {
  task?: Task;
  open: boolean;
  onClose: () => void;
  /** Вызывается после сохранения. Для НОВОЙ задачи получает созданную — экран спринтов по
   *  ней сразу кладёт задачу в спринт. Существующие вызывающие параметр игнорируют. */
  onSaved: (created?: Task) => void;
  // Создание с префиллом (напр. задача из встречи): начальные значения формы. Игнорируются
  // в режиме правки (когда передан task). assignee не префиллим — GPT даёт имя, не telegram_id.
  prefill?: {
    title?: string;
    description?: string | null;
    country?: string | null;
    due_date?: string | null;
    // Остальное — для черновика из разбора встречи: окно открывается с тем, что уже поправили.
    assignee_telegram_id?: number | null;
    assignee_person_id?: string | null;
    coassignee_person_ids?: string[];
    remind_date?: string | null;
    task_role?: string | null;
    label_ids?: string[];
    project_id?: string | null;
  };
  /** Черновик вместо создания: «Готово» отдаёт поля сюда, задача в систему НЕ уходит. Разбор
   *  задач из встречи создаёт их одной кнопкой «Добавить N задач» (владелец 27.10.2026: правка
   *  через карандаш сразу отправляла задачу в систему). */
  onDraft?: (fields: CreateTaskInput) => void;
  // Привязка создаваемой задачи к встрече-источнику (entry.id) → попадает в блок «Задачи из встречи».
  meetingId?: string | null;
  // Префилл проекта при создании (напр. из карточки/облака проекта). Игнорируется в режиме правки.
  projectId?: string | null;
}

// Панель справа: ширина — --detail-w стенда (560px), фон списка за ней лишь слегка притушен.
const DRAWER_CLS = "inset-y-0 top-0 right-0 left-auto flex h-dvh max-h-dvh w-[560px] max-w-[96vw] translate-x-0 translate-y-0 flex-col rounded-none border-0 border-l sm:max-w-[560px] data-open:zoom-in-100 data-open:slide-in-from-right-8 data-closed:zoom-out-100 data-closed:slide-out-to-right-8";

type SaveState = "idle" | "saving" | "saved" | "error";

export function TaskModal({ task: taskOpened, open, onClose, onSaved, prefill, meetingId, projectId, onDraft }: TaskModalProps) {
  // Переход по связи родитель ↔ подзадача внутри той же карточки (владелец 01.10.2026: «вижу
  // подзадачу, но нельзя перейти. хотя интуитивно хочется кликнуть»). Карточка остаётся открытой,
  // в ней просто другая задача; закрыли или открыли другую снаружи — переход забывается.
  const [navTask, setNavTask] = useState<Task | null>(null);
  useEffect(() => { setNavTask(null); }, [open, taskOpened?.id]);
  const taskProp = navTask ?? taskOpened;
  // На десктопе карточка задачи — ВСЕГДА панель справа на всю высоту (docs/redesign/stand
  // detail.js), колонки формы в ней идут одна под другой. Решает само окно, а не вызывающий экран:
  // пока это был флаг, его передавали три точки входа из десяти, и спринты, доска, таймлайн и
  // проекты открывали окно по центру (владелец 25.09.2026: «визуал работы с задачами будет везде
  // один: справа должно выходить окно для взаимодействия»). На мобайле — прежнее окно.
  const drawer = useIsDesktop();
  // Догрузка полной задачи живёт ЗДЕСЬ, а не в вызывающем экране. Раньше это было требованием
  // к вызывающей стороне («открыл задачу из списка — догрузи по id»), и из пяти точек входа его
  // соблюдала одна: список, доска, таймлайн и облако проекта отдавали объект из проекции
  // TASK_LIST_COLUMNS, карточка навсегда застревала в «Загружаем…» и МОЛЧА теряла все правки
  // (issue #145, владелец 2026-08-28: «нажимал что она выполнена, но нифига не сработало»).
  // Теперь любой вызывающий корректен по построению.
  const [hydrated, setHydrated] = useState<Task | null>(null);
  const [hydrateFailed, setHydrateFailed] = useState(false);
  const [hydrateAttempt, setHydrateAttempt] = useState(0);
  const task = hydrated && taskProp && hydrated.id === taskProp.id ? hydrated : taskProp;
  const isEdit = !!task;
  const confirm = useConfirm();
  const dt = useDt();

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("open");
  const [description, setDescription] = useState("");
  const [links, setLinks] = useState<TaskLink[]>([]);
  // Пока в описании есть сохранённый текст — показываем его как read-only с кликабельными
  // ссылками (linkify); textarea появляется по клику. Пустое описание — сразу editable.
  const [descEditing, setDescEditing] = useState(true);
  // Высота, которую блок «Описание» занимал в режиме ЧТЕНИЯ (issue #211). Чтение росло под
  // текст до 320px, а textarea открывалась жёсткими 160px — длинное описание схлопывалось на
  // клике, и править его приходилось через щель. Запоминаем фактическую высоту перед
  // переключением и стартуем редактор с неё; ручной resize-y остаётся.
  const descReadRef = useRef<HTMLDivElement | null>(null);
  // Название растёт по высоте под текст: длинный заголовок (часто из импорта) виден целиком,
  // а не обрезан краем поля (владелец 19.10.2026: «просто обрезать это не вариант»).
  // Высота подгоняется и при смене текста, и при смене ширины (панель открывается с анимацией,
  // окно ресайзят) — поэтому следим за самим полем, а не только за значением.
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const [titleEl, setTitleEl] = useState<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!titleEl) return;
    const fit = () => {
      titleEl.style.height = "auto";
      // scrollHeight без рамки, а высота поля — с рамкой (border-box): добавляем её, иначе низ букв срезается.
      titleEl.style.height = `${titleEl.scrollHeight + titleEl.offsetHeight - titleEl.clientHeight}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(titleEl);
    return () => ro.disconnect();
  }, [titleEl, title]);
  const [descHeight, setDescHeight] = useState<number | null>(null);
  const startDescEdit = () => {
    const h = descReadRef.current?.offsetHeight;
    if (h) setDescHeight(Math.min(Math.max(h, 100), 320));
    setDescEditing(true);
  };
  const [dueDate, setDueDate] = useState("");
  // Повтор: null — обычная задача. Правило (#823) считается от срока; без срока меню
  // повтора подставит срок = сегодня.
  const [recur, setRecur] = useState<RecurValue | null>(null);
  // Пинг — ручное напоминание, живёт рядом со сроком и независимо от него.
  const [remindDate, setRemindDate] = useState("");
  const [remindedAt, setRemindedAt] = useState<string | null>(null);
  const [countries, setCountries] = useState<string[]>([]);
  const [taskRole, setTaskRole] = useState(NONE);
  const [assigneeId, setAssigneeId] = useState(NONE);
  // Исходный исполнитель: чтобы при правке других полей не затирать его (PATCH шлём только при изменении).
  const [initialAssignee, setInitialAssignee] = useState(NONE);
  // Справочник людей (#874): исполнитель и соисполнители выбираются отсюда, в т. ч. люди без входа.
  const [people, setPeople] = useState<Person[]>([]);
  const [coIds, setCoIds] = useState<string[]>([]);
  const [initialCoIds, setInitialCoIds] = useState<string[]>([]);
  const [markets, setMarkets] = useState<string[]>([]);
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  // Свой telegram_id — по нему отбираются свои проекты в селекте (решение владельца 2026-09-06).
  const [myId, setMyId] = useState<number | null>(null);
  const [selProject, setSelProject] = useState<string | null>(task?.project_id ?? projectId ?? null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  // Снапшот последних сохранённых значений формы (JSON) — чтобы автосейв слал PATCH только при реальном изменении.
  const savedSnapRef = useRef("");

  // Задача из СПИСОЧНОГО ответа приходит БЕЗ description и task_role — их не тянет проекция
  // TASK_LIST_COLUMNS (issue #116). А buildPatch() ниже собирает PATCH из ВСЕХ полей формы, а не
  // только изменённых, поэтому автосейв на такой задаче отправил бы пустые description/task_role
  // и стёр реальные значения. undefined = «не загружено» (null — это «пусто», законное значение).
  // Пока полная версия не доехала, запись запрещена, а форма выключена — иначе кнопки
  // переключались бы, ничего не сохраняя, и врали бы человеку и скринридеру.
  const isPartial = isEdit && task?.description === undefined;

  // Догружаем ровно один раз на задачу: taskProp меняет идентичность при каждом обновлении
  // списка, поэтому сторожим по id, а не по ссылке. hydrateAttempt — ручной повтор из строки
  // ошибки.
  useEffect(() => {
    if (!open || !taskProp || taskProp.description !== undefined) return;
    if (hydrated?.id === taskProp.id) return;
    let cancelled = false;
    setHydrateFailed(false);
    fetchTask(taskProp.id)
      .then((full) => { if (!cancelled) setHydrated(full); })
      .catch(() => { if (!cancelled) setHydrateFailed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskProp?.id, taskProp?.description, hydrateAttempt]);

  // Закрыли карточку — забываем догруженное, иначе следующая откроется с чужими данными,
  // пока сторож по id не сработает.
  useEffect(() => {
    if (!open) { setHydrated(null); setHydrateFailed(false); }
  }, [open]);

  // Reset form whenever the dialog opens or the task changes
  useEffect(() => {
    if (!open) return;
    const initialTitle = task?.title ?? prefill?.title ?? "";
    const initialDescription = task?.description ?? prefill?.description ?? "";
    const initialStatus = normStatus(task?.status);
    const initialDue = task?.due_date ?? prefill?.due_date ?? "";
    const initialRemind = task?.remind_date ?? prefill?.remind_date ?? "";
    const initialRecur = task ? recurValueOf(task) : null;
    const initialCountries = task ? taskCountryCodes(task) : parseCountryList(prefill?.country);
    const initialRole = task?.task_role ?? prefill?.task_role ?? NONE;
    const cur = task ? assigneeTokenOf(task) : prefillAssigneeToken(prefill);
    const initialCo = task?.coassignee_person_ids ?? prefill?.coassignee_person_ids ?? [];
    const initialLabels = task?.label_ids ?? prefill?.label_ids ?? [];
    // Ссылок нет в списочной проекции: у недогруженной задачи здесь undefined, и пустой
    // список НЕ отправляется (isPartial глушит автосейв целиком — см. ниже).
    const initialLinks = task?.links ?? [];
    const initialProject = task?.project_id ?? prefill?.project_id ?? projectId ?? null;

    setTitle(initialTitle);
    setStatus(initialStatus);
    setDescription(initialDescription);
    setLinks(initialLinks);
    setDescEditing(!initialDescription.trim());
    setDueDate(initialDue);
    setRemindDate(initialRemind);
    setRecur(initialRecur);
    setRemindedAt(task?.reminded_at ?? null);
    setCountries(initialCountries);
    setTaskRole(initialRole);
    setAssigneeId(cur);
    setInitialAssignee(cur);
    setCoIds(initialCo);
    setInitialCoIds(initialCo);
    setLabelIds(initialLabels);
    setSelProject(initialProject);
    setSaveState("idle");
    setError(null);
    // Снапшот исходных значений — ключи ДОЛЖНЫ совпадать с formSnapshot(), иначе автосейв
    // сработает вхолостую сразу при открытии.
    savedSnapRef.current = JSON.stringify({
      title: initialTitle,
      description: initialDescription,
      status: initialStatus,
      dueDate: initialDue,
      remindDate: initialRemind,
      recur: initialRecur,
      countries: initialCountries,
      taskRole: initialRole,
      assigneeId: cur,
      coIds: initialCo,
      selProject: initialProject,
      labelIds: initialLabels,
      links: initialLinks,
    });

    fetchPeople().then(setPeople).catch(() => {});
    fetchTaskLabels().then(setLabels).catch(() => {});
    fetchConfig().then((c) => setMarkets(c.allowed_markets ?? [])).catch(() => {});
    // Новая задача — по умолчанию исполнитель = текущий пользователь (обычно чаще правит своё же).
    // Черновик с уже выбранным исполнителем его сохраняет.
    if (!task && prefillAssigneeToken(prefill) === NONE) {
      fetchMe().then((me) => setAssigneeId(me.telegram_id.toString())).catch(() => {});
    }
  }, [open, task, projectId]);

  // Список проектов для селекта — грузим один раз при монтировании модалки.
  // Личность тянем ТУТ ЖЕ и ставим состояние одним заходом: иначе между ответами
  // список успел бы мигнуть всеми проектами воркспейса, от чего и уходим.
  useEffect(() => {
    // С группами спринта: задача может лежать в группе, и пилюля должна её назвать. В пункты
    // выбора группы не попадают (buildProjectOptions).
    void Promise.all([fetchProjects({ sprintGroups: true }), fetchMe().then((m) => m.telegram_id).catch(() => null)])
      .then(([list, id]) => { setMyId(id); setProjects(list); })
      .catch(() => {});
  }, []);

  // Состав и порядок выпадашки «Проект»: только свои проекты и подпроекты, двумя секциями.
  const projectOptions = useMemo(() => buildProjectOptions(projects, { viewerId: myId }), [projects, myId]);

  // Исполнитель хранится токеном: telegram_id аккаунта (как раньше) или «p:<id>» человека без
  // входа. Выбор в справочнике переводится в токен и обратно.
  const assigneePersonIds = useMemo(() => {
    if (assigneeId === NONE) return [];
    if (assigneeId.startsWith(PERSON_TOKEN)) return [assigneeId.slice(PERSON_TOKEN.length)];
    const p = people.find((x) => x.telegram_id?.toString() === assigneeId);
    return p ? [p.id] : [];
  }, [assigneeId, people]);
  const pickAssignee = (ids: string[]) => {
    const p = people.find((x) => x.id === ids[0]);
    setAssigneeId(!p ? NONE : p.telegram_id != null ? p.telegram_id.toString() : PERSON_TOKEN + p.id);
  };
  // Имя на пилюле, пока справочник не загрузился или исполнителя в нём нет (старая задача).
  const assigneeFallback = assigneeId === NONE ? [] : (() => {
    const curName = task?.assignees?.[0];
    return [curName && !isRawId(curName) ? curName : `#${assigneeId}`];
  })();
  const addPerson = async (name: string, email: string | null) => {
    const p = await createPerson(name, email);
    setPeople((list) => (list.some((x) => x.id === p.id) ? list : [...list, p]));
    return p;
  };

  // Опции страны: рынки воркспейса (страна задачи вне них остаётся в списке — это делает сам поповер).
  const countryCodes = markets.length ? [...markets] : Object.keys(COUNTRY_NAMES);

  // Якорь числа показываем, только пока срок не тронут: изменил дату — подпись идёт за новой,
  // потому что сервер пересчитает якорь по тому же правилу (recurrencePatchFor).
  const recurAnchor = dueDate === (task?.due_date ?? "") ? task?.recur_anchor_dom : null;

  // Пилюля «проект › подпроект»: из одного выбранного id (задача живёт либо в проекте, либо в
  // подпроекте) достаём оба уровня. Имена — по ПОЛНОМУ списку: задача может лежать в чужом
  // проекте, которого нет среди своих пунктов выбора (buildProjectOptions).
  const selRow = !selProject || selProject === NONE ? null : (projects.find((p) => p.id === selProject) ?? null);
  const topProjectId = selRow ? (selRow.parent_id ?? selRow.id) : null;
  const subProjectId = selRow?.parent_id ? selRow.id : null;
  const topProjectName = topProjectId ? (projects.find((p) => p.id === topProjectId)?.name ?? null) : null;
  const subProjectName = subProjectId ? (selRow?.name ?? null) : null;
  const subsOfTop = topProjectId ? projectOptions.subs.filter((o) => o.parentId === topProjectId) : [];

  // Текущий снапшот формы (для сравнения с сохранённым) — те же ключи, что в useEffect open.
  const formSnapshot = () =>
    JSON.stringify({ title, description, status, dueDate, remindDate, recur, countries, taskRole, assigneeId, coIds, selProject, labelIds, links });

  // Собрать PATCH из текущих значений формы. null → сохранять нечего/нельзя (пустое название).
  const buildPatch = (): UpdateTaskInput | null => {
    if (!task) return null;
    const t = title.trim();
    if (!t) return null;
    const patch: UpdateTaskInput = {
      title: t,
      description: description.trim() || null,
      due_date: dueDate || null,
      remind_date: remindDate || null,
      recur_freq: recur?.freq ?? null,
      recur_interval: recur?.interval ?? 1,
      recur_weekdays: recur?.weekdays ?? null,
      recur_setpos: recur?.setpos ?? null,
      countries,
      task_role: taskRole === NONE ? null : taskRole,
      status,
      project_id: selProject,
      links,
    };
    // Исполнителя шлём только если поменяли — иначе правка других полей затёрла бы назначение,
    // которое нельзя было префиллить (имя без telegram_id).
    if (assigneeId !== initialAssignee) Object.assign(patch, assigneeFields(assigneeId));
    if (JSON.stringify(coIds) !== JSON.stringify(initialCoIds)) patch.coassignee_person_ids = coIds;
    // Списки шлём только если поменяли — как исполнителя: иначе правка других полей перезаписала
    // бы метки тем, что было на момент открытия. Видимость задачи списки не меняют (09.10.2026).
    const sameLabels = (a: string[], b: string[]) =>
      a.length === b.length && [...a].sort().join() === [...b].sort().join();
    if (!sameLabels(labelIds, task.label_ids ?? [])) patch.label_ids = labelIds;
    return patch;
  };

  // Автосохранение (edit): при любом изменении формы — debounce → PATCH. Кнопки «Сохранить» нет.
  useEffect(() => {
    if (!open || !isEdit || !task || isPartial) return;
    const snap = formSnapshot();
    if (snap === savedSnapRef.current) return; // ничего не менялось
    if (!title.trim()) return; // пустое название не сохраняем (обязательное поле)
    const patch = buildPatch();
    if (!patch) return;
    const h = setTimeout(async () => {
      setSaveState("saving");
      try {
        await updateTask(task.id, patch);
        savedSnapRef.current = snap;
        setSaveState("saved");
        onSaved();
      } catch {
        setSaveState("error");
      }
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, isPartial, title, description, status, dueDate, remindDate, recur, countries, taskRole, assigneeId, coIds, selProject, labelIds, links]);

  // Досрочно сохраняем pending-изменения (пока debounce не успел сработать) — перед закрытием
  // и перед переходом к связанной задаче.
  const flushPending = () => {
    if (isEdit && task && !isPartial && title.trim()) {
      const snap = formSnapshot();
      if (snap !== savedSnapRef.current) {
        const patch = buildPatch();
        if (patch) {
          savedSnapRef.current = snap;
          updateTask(task.id, patch).then(onSaved).catch(() => {});
        }
      }
    }
  };
  const openRelated = (t: Task) => {
    flushPending();
    setNavTask(t);
  };

  // Закрытие: досрочно сохраняем pending-изменения (пока debounce не успел сработать).
  const handleClose = () => {
    flushPending();
    onClose();
  };

  // Создание новой задачи — единственная точка с явной кнопкой (в edit сохранение автоматом).
  const handleCreate = async () => {
    if (!title.trim()) {
      setError(dt(TASK_MODAL_COPY.titleRequired.ru, TASK_MODAL_COPY.titleRequired.en));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const base = {
        title: title.trim(),
        description: description.trim() || null,
        links,
        due_date: dueDate || null,
        remind_date: remindDate || null,
        recur_freq: recur?.freq ?? null,
        recur_interval: recur?.interval ?? 1,
        recur_weekdays: recur?.weekdays ?? null,
        recur_setpos: recur?.setpos ?? null,
        countries,
        task_role: taskRole === NONE ? null : taskRole,
      };
      const fields: CreateTaskInput = { ...base, ...assigneeFields(assigneeId), project_id: selProject };
      if (coIds.length > 0) fields.coassignee_person_ids = coIds;
      if (onDraft) {
        onDraft({ ...fields, ...(labelIds.length > 0 ? { label_ids: labelIds } : {}) });
        onClose();
        return;
      }
      if (meetingId) fields.meeting_id = meetingId;
      const created = await createTask(fields);
      // POST /tasks не принимает label_ids — вешаем метки вторым шагом.
      if (labelIds.length > 0) await updateTask(created.id, { label_ids: labelIds });
      onSaved(created);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : dt(TASK_MODAL_COPY.createError.ru, TASK_MODAL_COPY.createError.en));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    if (!(await confirm({ title: `${dt(TASK_MODAL_COPY.deleteAction.ru, TASK_MODAL_COPY.deleteAction.en)} «${task.title}»?`, description: "Задача будет удалена без возможности восстановления.", confirmText: dt(TASK_MODAL_COPY.deleteAction.ru, TASK_MODAL_COPY.deleteAction.en), cancelText: dt(TASK_MODAL_COPY.cancel.ru, TASK_MODAL_COPY.cancel.en) }))) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteTask(task.id);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : dt(TASK_MODAL_COPY.deleteError.ru, TASK_MODAL_COPY.deleteError.en));
    } finally {
      setDeleting(false);
    }
  };

  const titleMissing = isEdit && !title.trim();
  const saveHint = hydrateFailed
    ? dt(TASK_MODAL_COPY.loadError.ru, TASK_MODAL_COPY.loadError.en)
    : isPartial
    ? dt(TASK_MODAL_COPY.loading.ru, TASK_MODAL_COPY.loading.en)
    : titleMissing
    ? dt(TASK_MODAL_COPY.titleRequired.ru, TASK_MODAL_COPY.titleRequired.en)
    : saveState === "saving"
      ? dt(TASK_MODAL_COPY.saving.ru, TASK_MODAL_COPY.saving.en)
      : saveState === "error"
        ? dt(TASK_MODAL_COPY.saveError.ru, TASK_MODAL_COPY.saveError.en)
        : saveState === "saved"
          ? dt(TASK_MODAL_COPY.saved.ru, TASK_MODAL_COPY.saved.en)
          : "";
  const saveHintDanger = titleMissing || saveState === "error" || hydrateFailed;

  // Ссылки, подзадачи и файлы: пустые — пиктограммами в одной строке, непустые — разделами
  // (решение владельца 01.10.2026, docs/decisions/2026-10-01-task-card-compact-sections.md).
  const sections = useCardSections({
    task: task ?? null,
    isEdit,
    isPartial,
    links,
    setLinks,
    onSaved,
    onOpenTask: openRelated,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o, details) => {
        // Открыто меню выбора — Escape принадлежит ему, а не карточке (#881): отменяем закрытие,
        // меню закроется своим обработчиком (Base UI зовёт этот раньше — меню ещё в DOM).
        if (!o && details.reason === "escape-key" && hasOpenEscapeLayer(document)) {
          details.cancel();
          return;
        }
        if (!o) handleClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        overlayClassName={drawer ? "bg-[rgba(10,13,17,.12)]" : undefined}
        className={cn("gap-0 rounded-[14px] border border-line bg-[var(--popover)] p-0 sm:max-w-2xl", drawer && DRAWER_CLS)}
        {...sections.dropProps}
      >
        {sections.fileInput}
        {sections.dropOverlay}
        {/* Шапка: заголовок + индикатор автосейва (edit) + удалить (edit) + закрыть */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-[18px] py-2.5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h2 className="shrink-0 font-semibold text-ink" style={{ fontSize: 16, letterSpacing: "-0.01em" }}>
              {isEdit ? dt("Изменить задачу", "Edit task") : dt("Новая задача", "New task")}
            </h2>
            {isEdit && saveHint && (
              <span
                className="truncate"
                style={{ fontSize: 12, color: saveHintDanger ? "var(--pri-high)" : "var(--ink-mute)" }}
              >
                {saveHint}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isEdit && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                aria-label={dt(TASK_MODAL_COPY.deleteTask.ru, TASK_MODAL_COPY.deleteTask.en)}
                title={dt(TASK_MODAL_COPY.deleteTask.ru, TASK_MODAL_COPY.deleteTask.en)}
                // Тач-цель 40x40: на телефоне кнопка была 29x29 при норме 44 — и это удаление.
                className="flex size-10 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface-2 hover:text-[var(--pri-high)] active:scale-[0.95] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <RoyIcon name="trash" size={17} />
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              aria-label={dt(TASK_MODAL_COPY.close.ru, TASK_MODAL_COPY.close.en)}
              className="flex size-10 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <RoyIcon name="x" size={18} />
            </button>
          </div>
        </div>

        {/* Поля — одна колонка: название, чипы настроек, списки, ссылки, описание (макет 28.09.2026). */}
        <div className={cn("overflow-y-auto px-[18px] py-3.5", drawer ? "min-h-0 flex-1" : "max-h-[80vh]")}>
          {/* Отказ догрузки — ГРОМКИЙ. Раньше это был один тост и навсегда мёртвая форма:
              человек правил задачу, ничего не сохранялось, и никто ему об этом не говорил. */}
          {hydrateFailed && (
            <TaskHydrationNotice setHydrateAttempt={setHydrateAttempt} />
          )}
          {/* Пока задача неполная, форма ВЫКЛЮЧЕНА: fieldset[disabled] гасит и поля, и кнопки.
              Иначе статус «нажимается», значение в форме меняется, PATCH не уходит — и интерфейс
              врёт человеку и скринридеру (aria-pressed переключался на несохранённом). */}
          <fieldset
            disabled={isPartial}
            aria-busy={isPartial && !hydrateFailed}
            className={`m-0 min-w-0 border-0 p-0 ${isPartial ? "opacity-60" : ""}`}
          >
          {/* Порядок карточки — по макету владельца 28.09.2026: название → все настройки чипами
              прямо под ним → Списки → Ссылки → Описание → Подзадачи → Комментарии. Одна колонка
              и в панели справа, и в окне на телефоне. Логика выбора у каждого свойства прежняя
              (те же DatePicker, CountryPopover, Select) — поменялась только оболочка-кнопка. */}
          <div className="flex flex-col gap-3.5">
            <div data-card-block="title">
              <label htmlFor="modal-title" className="sr-only">{dt("Название", "Title")}</label>
              <textarea
                id="modal-title"
                ref={(el) => { titleRef.current = el; setTitleEl(el); }}
                rows={1}
                className={`${fieldCls} resize-none overflow-hidden font-semibold`}
                style={{ fontSize: 16, lineHeight: 1.35 }}
                value={title}
                // Название — одна строка смысла: перевод строки из вставки становится пробелом,
                // Enter строку не рвёт (как у прежнего однострочного поля).
                onChange={(e) => setTitle(e.target.value.replace(/\s*\n\s*/g, " "))}
                onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                placeholder={dt("Название задачи", "Task title")}
                aria-required
              />
            </div>

            <TaskModalProperties
              NONE={NONE}
              isEdit={isEdit}
              task={task}
              status={status}
              setStatus={setStatus}
              dueDate={dueDate}
              setDueDate={setDueDate}
              recur={recur}
              setRecur={setRecur}
              recurAnchor={recurAnchor}
              remindDate={remindDate}
              setRemindDate={setRemindDate}
              remindedAt={remindedAt}
              setRemindedAt={setRemindedAt}
              topProjectId={topProjectId}
              topProjectName={topProjectName}
              projectOptions={projectOptions}
              subProjectId={subProjectId}
              subProjectName={subProjectName}
              subsOfTop={subsOfTop}
              setSelProject={setSelProject}
              onSaved={onSaved}
              countries={countries}
              countryCodes={countryCodes}
              setCountries={setCountries}
              people={people}
              assigneePersonIds={assigneePersonIds}
              pickAssignee={pickAssignee}
              addPerson={addPerson}
              assigneeFallback={assigneeFallback}
              coIds={coIds}
              setCoIds={setCoIds}
            />

            {SHOW_TASK_ROLE && (
              <div>
                <label htmlFor="modal-role" className={labelCls} style={{ fontSize: 12 }}>{dt(TASK_MODAL_COPY.role.ru, TASK_MODAL_COPY.role.en)}</label>
                {/* Своё меню, а не нативный <select>: macOS раскрывает тот системным поверх интерфейса (#300). */}
                <Select value={taskRole} onValueChange={(v) => setTaskRole(v ?? NONE)}>
                  <SelectTrigger id="modal-role" className={fieldCls}>
                    {TASK_ROLES.find((r) => r.value === taskRole)?.label ?? dt("— Нет —", "— None —")}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{dt("— Нет —", "— None —")}</SelectItem>
                    {TASK_ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Персональные списки-метки — многозначное свойство, поэтому своим блоком чипов. */}
            {labels.length > 0 && (
              <div data-card-block="lists">
                <span className={labelCls} style={{ fontSize: 12 }}>{dt("Списки", "Lists")}</span>
                <div className="flex flex-wrap gap-1.5">
                  {labels.map((l) => {
                    const on = labelIds.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setLabelIds((prev) => (prev.includes(l.id) ? prev.filter((x) => x !== l.id) : [...prev, l.id]))}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${on ? "border-primary bg-accent-soft text-accent-ink" : "border-line-2 bg-surface text-ink-soft hover:bg-surface-2"}`}
                        style={{ fontSize: 12 }}
                      >
                        <RoyIcon name={((l.icon as RoyIconName) || "tag")} size={13} strokeWidth={1.9} />
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Строка пиктограмм пустых разделов — на месте прежнего поля ссылок, над описанием:
                так она всегда на первом экране, даже под длинным описанием, а заполненные
                «Ссылки» встают ровно туда, где была пиктограмма. */}
            {links.length > 0 && <div data-card-block="links">{sections.linksSection}</div>}
            {sections.bar}

            <TaskDescription
              descEditing={descEditing}
              description={description}
              isEdit={isEdit}
              descHeight={descHeight}
              descReadRef={descReadRef}
              setDescription={setDescription}
              setDescEditing={setDescEditing}
              startDescEdit={startDescEdit}
            />
          </div>
          </fieldset>

          {sections.subtasksSection && (
            <div data-card-block="subtasks" className="mt-3.5 border-t border-line pt-3">
              {sections.subtasksSection}
            </div>
          )}

          {sections.filesSection && (
            <div data-card-block="files" className="mt-3.5 border-t border-line pt-3">
              {sections.filesSection}
            </div>
          )}

          {isEdit && task && (
            <div data-card-block="comments" className="mt-3.5 border-t border-line pt-3">
              <TaskComments taskId={task.id} />
              <TaskOrigin task={task} />
            </div>
          )}

          {error && <p className="mt-3 font-semibold" style={{ fontSize: 13, color: "var(--pri-high)" }}>{error}</p>}
        </div>

        {/* Нижняя панель действий — только при создании (в edit сохранение автоматическое). */}
        {!isEdit && (
          <div className="flex items-center justify-end gap-2 rounded-b-[14px] border-t border-line bg-surface-2 px-[18px] py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={creating}
              className="h-[30px] rounded-full border border-line-2 bg-surface px-3 font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              style={{ fontSize: 12.5 }}
            >
              {dt(TASK_MODAL_COPY.cancel.ru, TASK_MODAL_COPY.cancel.en)}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="h-[30px] rounded-full bg-primary px-3.5 font-semibold text-primary-foreground transition-[transform,background-color] hover:bg-primary/90 active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              style={{ fontSize: 12.5 }}
            >
              {onDraft ? dt(TASK_MODAL_COPY.done.ru, TASK_MODAL_COPY.done.en) : creating ? dt(TASK_MODAL_COPY.creating.ru, TASK_MODAL_COPY.creating.en) : dt(TASK_MODAL_COPY.create.ru, TASK_MODAL_COPY.create.en)}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
