"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import type { Task, TaskLink, Person, Project } from "@/types";
import { useCardSections } from "@/components/tasks/useCardSections";
import { displayName } from "@/lib/utils";
import { DatePicker } from "@/components/ui/DatePicker";
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
import { PILL_GROUP_CLS, pillSegmentCls, pillSegmentSelectCls, PropertyPillBody, propertyPillSelectCls } from "@/components/ui/PropertyPill";
import { useConfirm } from "@/components/ui/confirm";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { TaskComments } from "@/components/tasks/TaskComments";
import { COUNTRY_NAMES, countryCode } from "@/lib/countries";
import { CountryPopover } from "@/components/tasks/CountryPopover";
import { PeoplePopover } from "@/components/tasks/PeoplePopover";
import { linkify } from "@/lib/linkify";
import { useDt } from "@/components/roy/nav";
import { useIsDesktop } from "@/components/roy/useIsDesktop";
import { recurValueOf, type RecurValue } from "@/lib/recurrenceLabels";
import { RecurrencePicker } from "@/components/tasks/RecurrencePicker";
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

// Статусы пиктограммами: открыто — пустой круг, в работе — часы, готово — галочка.
// Иконка "circle" рисуется CSS-бордером (в наборе RoyIcon кружка нет).
const STATUSES: { id: string; label: string; en: string; icon: RoyIconName | "circle" }[] = [
  { id: "open", label: "Открыто", en: "Open", icon: "circle" },
  { id: "in_progress", label: "В работе", en: "In progress", icon: "clock" },
  { id: "done", label: "Готово", en: "Done", icon: "check" },
];
const normStatus = (s?: string | null) => (s === "progress" ? "in_progress" : (s ?? "open"));

// Исполнитель без входа в Swarm хранится в форме токеном «p:<person id>» (#874).
const PERSON_TOKEN = "p:";

function assigneeTokenOf(task: Task | null | undefined): string {
  const tg = task?.assignee_telegram_ids?.[0];
  if (tg != null) return tg.toString();
  return task?.assignee_person_id ? PERSON_TOKEN + task.assignee_person_id : NONE;
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

// Roy-стилизованные нативные контролы (без shadcn): стекло + линия + янтарный фокус.
// min-h-10 — тач-цель полей на телефоне (было 38px при норме 44).
const fieldCls =
  "w-full min-h-9 rounded-[8px] border border-line-2 bg-surface px-2.5 py-2 text-sm text-ink outline-none transition-[border-color,box-shadow] focus:border-primary focus:ring-3 focus:ring-accent-soft placeholder:text-ink-mute";
const labelCls = "mb-1 block font-medium text-ink-soft";

interface TaskModalProps {
  task?: Task;
  open: boolean;
  onClose: () => void;
  /** Вызывается после сохранения. Для НОВОЙ задачи получает созданную — экран спринтов по
   *  ней сразу кладёт задачу в спринт. Существующие вызывающие параметр игнорируют. */
  onSaved: (created?: Task) => void;
  // Создание с префиллом (напр. задача из встречи): начальные значения формы. Игнорируются
  // в режиме правки (когда передан task). assignee не префиллим — GPT даёт имя, не telegram_id.
  prefill?: { title?: string; description?: string | null; country?: string | null; due_date?: string | null };
  // Привязка создаваемой задачи к встрече-источнику (entry.id) → попадает в блок «Задачи из встречи».
  meetingId?: string | null;
  // Префилл проекта при создании (напр. из карточки/облака проекта). Игнорируется в режиме правки.
  projectId?: string | null;
}

// Панель справа: ширина — --detail-w стенда (560px), фон списка за ней лишь слегка притушен.
const DRAWER_CLS = "inset-y-0 top-0 right-0 left-auto flex h-dvh max-h-dvh w-[560px] max-w-[96vw] translate-x-0 translate-y-0 flex-col rounded-none border-0 border-l sm:max-w-[560px] data-open:zoom-in-100 data-open:slide-in-from-right-8 data-closed:zoom-out-100 data-closed:slide-out-to-right-8";

type SaveState = "idle" | "saving" | "saved" | "error";

// Происхождение задачи: когда заведена и кем (владелец 2026-08-20: «не ясно, когда задача была
// закинута, и кто её создал»). Подвал под комментариями — там же, где обычно ищут историю.
// Дата полная (день-месяц-год): задачи живут дольше встреч, «10 авг.» без года двусмысленно.
// Автора может не быть у старых задач и у пришедших из встреч/бота — тогда молчим, а не пишем
// «неизвестно»: пустая строка честнее выдуманной.
function TaskOrigin({ task }: { task: Task }) {
  const dt = useDt();
  const created = (() => {
    if (!task.created_at) return null;
    const d = new Date(task.created_at);
    if (isNaN(d.getTime())) return null;
    // ru-RU с year:numeric добавляет « г.» — в интерфейсе это канцелярит, режем.
    return d.toLocaleDateString(dt("ru-RU", "en-GB"), { day: "numeric", month: "long", year: "numeric" }).replace(/\s*г\.$/, "");
  })();
  if (!created && !task.created_by_name) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-line pt-2.5 text-ink-mute" style={{ fontSize: 11.5 }}>
      <RoyIcon name="clock" size={12} strokeWidth={1.9} className="shrink-0" />
      {created && <span>{dt("Создана", "Created")} {created}</span>}
      {created && task.created_by_name && <span aria-hidden>·</span>}
      {task.created_by_name && <span>{dt("автор:", "by")} <span className="text-ink-soft font-medium">{task.created_by_name}</span></span>}
    </div>
  );
}

export function TaskModal({ task: taskOpened, open, onClose, onSaved, prefill, meetingId, projectId }: TaskModalProps) {
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
  const [country, setCountry] = useState("");
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
    const initialRemind = task?.remind_date ?? "";
    const initialRecur = task ? recurValueOf(task) : null;
    const initialCountry = task?.country ?? prefill?.country ?? "";
    const initialRole = task?.task_role ?? NONE;
    const cur = assigneeTokenOf(task);
    const initialCo = task?.coassignee_person_ids ?? [];
    const initialLabels = task?.label_ids ?? [];
    // Ссылок нет в списочной проекции: у недогруженной задачи здесь undefined, и пустой
    // список НЕ отправляется (isPartial глушит автосейв целиком — см. ниже).
    const initialLinks = task?.links ?? [];
    const initialProject = task?.project_id ?? projectId ?? null;

    setTitle(initialTitle);
    setStatus(initialStatus);
    setDescription(initialDescription);
    setLinks(initialLinks);
    setDescEditing(!initialDescription.trim());
    setDueDate(initialDue);
    setRemindDate(initialRemind);
    setRecur(initialRecur);
    setRemindedAt(task?.reminded_at ?? null);
    setCountry(initialCountry);
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
      country: initialCountry,
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
    if (!task) {
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

  // Опции страны: рынки воркспейса + «Global» (пусто) + легаси-фолбэк (страна задачи вне
  // текущего allowed_markets — чтобы при редактировании не потерять её).
  const countryCodes = markets.length ? [...markets] : Object.keys(COUNTRY_NAMES);
  let selectedCountryId = country;
  if (country) {
    const normalizedCountry = countryCode(country);
    const matchedCode = countryCodes.find((code) => countryCode(code) === normalizedCountry);
    if (matchedCode) {
      selectedCountryId = matchedCode;
    } else {
      countryCodes.push(country);
    }
  }

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
    JSON.stringify({ title, description, status, dueDate, remindDate, recur, country, taskRole, assigneeId, coIds, selProject, labelIds, links });

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
      country: country || null,
      task_role: taskRole === NONE ? null : taskRole,
      status,
      project_id: selProject,
      links,
    };
    // Исполнителя шлём только если поменяли — иначе правка других полей затёрла бы назначение,
    // которое нельзя было префиллить (имя без telegram_id).
    if (assigneeId !== initialAssignee) Object.assign(patch, assigneeFields(assigneeId));
    if (JSON.stringify(coIds) !== JSON.stringify(initialCoIds)) patch.coassignee_person_ids = coIds;
    // Списки — личные: выбор списка делает задачу личной (метки живут только на личных задачах).
    if (labelIds.length > 0 && !task.is_private) patch.is_private = true;
    if (task.is_private || labelIds.length > 0) patch.label_ids = labelIds;
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
  }, [open, isEdit, isPartial, title, description, status, dueDate, remindDate, recur, country, taskRole, assigneeId, coIds, selProject, labelIds, links]);

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
      setError("Нужно название");
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
        country: country || null,
        task_role: taskRole === NONE ? null : taskRole,
      };
      const fields: CreateTaskInput = { ...base, ...assigneeFields(assigneeId), project_id: selProject };
      if (coIds.length > 0) fields.coassignee_person_ids = coIds;
      if (meetingId) fields.meeting_id = meetingId;
      if (labelIds.length > 0) fields.is_private = true;
      const created = await createTask(fields);
      // POST /tasks не принимает label_ids — вешаем метки вторым шагом на уже личную задачу.
      if (labelIds.length > 0) await updateTask(created.id, { label_ids: labelIds });
      onSaved(created);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось создать");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    if (!(await confirm({ title: `Удалить «${task.title}»?`, description: "Задача будет удалена без возможности восстановления." }))) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteTask(task.id);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setDeleting(false);
    }
  };

  const titleMissing = isEdit && !title.trim();
  const saveHint = hydrateFailed
    ? "Не загрузилось"
    : isPartial
    ? "Загружаем…"
    : titleMissing
    ? "Нужно название"
    : saveState === "saving"
      ? "Сохранение…"
      : saveState === "error"
        ? "Не сохранилось"
        : saveState === "saved"
          ? "Сохранено"
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
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
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
                aria-label="Удалить задачу"
                title="Удалить задачу"
                // Тач-цель 40x40: на телефоне кнопка была 29x29 при норме 44 — и это удаление.
                className="flex size-10 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface-2 hover:text-[var(--pri-high)] active:scale-[0.95] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <RoyIcon name="trash" size={17} />
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              aria-label="Закрыть"
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
            <div
              className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[8px] border px-3 py-2"
              style={{
                borderColor: "color-mix(in srgb, var(--pri-high) 40%, transparent)",
                background: "color-mix(in srgb, var(--pri-high) 8%, transparent)",
              }}
            >
              <RoyIcon name="warn" size={15} className="shrink-0 text-[var(--pri-high)]" />
              <span className="min-w-0 flex-1 text-ink" style={{ fontSize: 12.5 }}>
                {dt(
                  "Не удалось загрузить задачу целиком. Правки заблокированы, чтобы не стереть описание.",
                  "Could not load the full task. Editing is blocked so the description isn't wiped.",
                )}
              </span>
              <button
                type="button"
                onClick={() => setHydrateAttempt((n) => n + 1)}
                className="shrink-0 rounded-full border border-line-2 bg-surface px-3 font-medium text-ink transition-colors hover:bg-surface-2 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                style={{ fontSize: 12.5, minHeight: 30 }}
              >
                {dt("Повторить", "Retry")}
              </button>
            </div>
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
              <input
                id="modal-title"
                className={`${fieldCls} font-semibold`}
                style={{ fontSize: 16 }}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={dt("Название задачи", "Task title")}
                aria-required
              />
            </div>

            <div data-card-block="props" className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {/* Статус — сегмент из трёх, текущий подсвечен и подписан (макет 28.09.2026). */}
                {isEdit && (
                  <span role="group" aria-label={dt("Статус", "Status")} className={PILL_GROUP_CLS}>
                    {STATUSES.map((s) => {
                      const on = s.id === status;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setStatus(s.id)}
                          aria-label={dt(s.label, s.en)}
                          aria-pressed={on}
                          title={dt(s.label, s.en)}
                          className={pillSegmentCls(on)}
                          style={{ fontSize: 12.5 }}
                        >
                          {s.icon === "circle" ? (
                            <span className="rounded-full border-2 border-current" style={{ width: 12, height: 12 }} />
                          ) : (
                            <RoyIcon name={s.icon} size={14} strokeWidth={2} />
                          )}
                          {on && <span>{dt(s.label, s.en)}</span>}
                        </button>
                      );
                    })}
                  </span>
                )}

                {/* Срок · пинг · повтор — одна пилюля по логике статуса (владелец 29.09.2026):
                    пустой сегмент — бледный значок, заданный — заливка и значение, пилюля растёт
                    ровно на то, что задано. Повтор считается от срока; без срока меню повтора
                    подставит срок = сегодня. Быстрые варианты и «Настроить…» — в RecurrencePicker
                    (#823). */}
                <span role="group" aria-label={dt("Сроки", "Dates")} className={PILL_GROUP_CLS}>
                  <DatePicker
                    variant="segment"
                    value={dueDate}
                    // Сняли срок — цикличность гаснет вместе с ним: без срока считать следующее
                    // вхождение не от чего, а тихо оставленная частота молча перестала бы работать.
                    onChange={(iso) => { setDueDate(iso); if (!iso) setRecur(null); }}
                    ariaLabel={dt("Срок", "Due date")}
                    clearLabel={dt("Убрать срок", "Clear due date")}
                  />
                  <DatePicker
                    variant="segment"
                    value={remindDate}
                    onChange={(iso) => { setRemindDate(iso); setRemindedAt(null); }}
                    icon="bell"
                    ariaLabel={dt("Пинг", "Ping")}
                    clearLabel={dt("Убрать пинг", "Clear ping")}
                  />
                  <RecurrencePicker
                    variant="segment"
                    value={recur}
                    due={dueDate}
                    anchorDom={recurAnchor}
                    onChange={(v, due) => { setRecur(v); if (due) setDueDate(due); }}
                  />
                </span>

                {/* Проект › подпроект — сегментная пилюля (владелец 29.09.2026: «чтобы это
                    отображалось и при нажатии можно было перекинуть задачу из проекта в проект или из
                    подпроекта в подпроект»). Первый сегмент — проект: смена переносит задачу в корень
                    другого проекта. Второй — подпроект ЭТОГО проекта; виден, когда их есть из чего
                    выбрать или задача уже в подпроекте. */}
                <span role="group" aria-label={dt("Проект", "Project")} className={PILL_GROUP_CLS}>
                  <Select value={topProjectId ?? NONE} onValueChange={(v) => setSelProject(!v || v === NONE ? null : v)}>
                    <SelectTrigger
                      id="modal-project"
                      title={topProjectName ? `${dt("Проект", "Project")}: ${topProjectName}` : dt("Проект", "Project")}
                      aria-label={topProjectName ? `${dt("Проект", "Project")}: ${topProjectName}` : dt("Проект", "Project")}
                      className={pillSegmentSelectCls(!!topProjectName)}
                    >
                      {/* Подпись считаем САМИ (base-ui Value в этой версии рисует сырое значение/UUID). */}
                      <RoyIcon name="board" size={14} strokeWidth={2} />
                      {topProjectName && <span className="truncate" style={{ fontSize: 12.5 }}>{topProjectName}</span>}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{dt("Без проекта", "No project")}</SelectItem>
                      {projectOptions.tops.map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {topProjectId && (subsOfTop.length > 0 || subProjectId) && (
                    <Select value={subProjectId ?? NONE} onValueChange={(v) => setSelProject(!v || v === NONE ? topProjectId : v)}>
                      <SelectTrigger
                        title={subProjectName ? `${dt("Подпроект", "Subproject")}: ${subProjectName}` : dt("Подпроект", "Subproject")}
                        aria-label={subProjectName ? `${dt("Подпроект", "Subproject")}: ${subProjectName}` : dt("Подпроект", "Subproject")}
                        className={pillSegmentSelectCls(!!subProjectName)}
                      >
                        <RoyIcon name="cright" size={13} strokeWidth={2} />
                        {subProjectName && <span className="truncate" style={{ fontSize: 12.5 }}>{subProjectName}</span>}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{dt("Без подпроекта", "No subproject")}</SelectItem>
                        {subsOfTop.map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </span>

                {/* Выбор страны — контекстное меню: чип-триггер + портал-поповер с сеткой флагов. */}
                <CountryPopover
                  value={selectedCountryId}
                  codes={countryCodes}
                  onChange={setCountry}
                  variant="pill"
                  label={dt("Страна", "Country")}
                />

                {/* «Общие» = без конкретного исполнителя → командная задача (вкладка «Команда»).
                    Человека нет в списке — добавляется тут же (#874). */}
                <PeoplePopover
                  people={people}
                  selected={assigneePersonIds}
                  onChange={pickAssignee}
                  onCreate={addPerson}
                  label={dt("Исполнитель", "Assignee")}
                  icon="team"
                  emptyLabel={dt("Общие", "Unassigned")}
                  clearLabel={dt("Общие (вся команда)", "Unassigned (whole team)")}
                  fallbackNames={assigneeFallback}
                />
                <PeoplePopover
                  multiple
                  people={people}
                  selected={coIds}
                  onChange={setCoIds}
                  onCreate={addPerson}
                  label={dt("Соисполнители", "Co-assignees")}
                  icon="team"
                  emptyLabel={dt("Соисполнители", "Co-assignees")}
                />
              </div>

              {/* Подсказка молчит, пока пинга нет. «Уже напомнили» показываем всегда — она
                  объясняет, почему дата стоит, а звонка больше не будет. */}
              {remindDate && (
                <p className="text-ink-mute" style={{ fontSize: 11 }}>
                  {remindedAt
                    ? dt("Пинг: уже напомнили — выбери новый день, чтобы напомнить снова", "Ping: already sent — pick a new day to be reminded again")
                    : dt("Пинг: напомним в этот день, один раз", "Ping: one reminder on this day")}
                </p>
              )}
            </div>

            {SHOW_TASK_ROLE && (
              <div>
                <label htmlFor="modal-role" className={labelCls} style={{ fontSize: 12 }}>Роль</label>
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
                {labelIds.length > 0 && !task?.is_private && (
                  <p className="mt-1.5 text-ink-mute" style={{ fontSize: 11.5 }}>
                    {dt("Список личный — задача станет видна только тебе.", "Lists are personal — the task will be visible only to you.")}
                  </p>
                )}
              </div>
            )}

            {/* Строка пиктограмм пустых разделов — на месте прежнего поля ссылок, над описанием:
                так она всегда на первом экране, даже под длинным описанием, а заполненные
                «Ссылки» встают ровно туда, где была пиктограмма. */}
            {links.length > 0 && <div data-card-block="links">{sections.linksSection}</div>}
            {sections.bar}

            <div data-card-block="description" className="flex flex-col">
              <label htmlFor="modal-desc" className={labelCls} style={{ fontSize: 12 }}>{dt("Описание", "Description")}</label>
              {descEditing ? (
                <textarea
                  id="modal-desc"
                  autoFocus={isEdit}
                  className={`${fieldCls} resize-y`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => { if (description.trim()) setDescEditing(false); }}
                  placeholder={dt("Подробности, контекст, что именно сделать…", "Details, context, what exactly to do…")}
                  style={{ height: descHeight ?? 160, minHeight: 100, lineHeight: 1.55 }}
                />
              ) : (
                <div
                  id="modal-desc"
                  role="button"
                  tabIndex={0}
                  ref={descReadRef}
                  onClick={startDescEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      startDescEdit();
                    }
                  }}
                  className={`${fieldCls} max-h-[320px] cursor-text overflow-y-auto whitespace-pre-wrap`}
                  style={{ minHeight: 100, lineHeight: 1.55 }}
                >
                  {linkify(description)}
                </div>
              )}
            </div>
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
              Отмена
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="h-[30px] rounded-full bg-primary px-3.5 font-semibold text-primary-foreground transition-[transform,background-color] hover:bg-primary/90 active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              style={{ fontSize: 12.5 }}
            >
              {creating ? "Создание…" : "Создать"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
