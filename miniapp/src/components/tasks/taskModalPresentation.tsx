import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Person, Task } from "@/types";
import type { ProjectOption, ProjectPickerOptions } from "@/lib/projectPicker";
import type { RecurValue } from "@/lib/recurrenceLabels";
import { useDt } from "@/components/roy/nav";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";
import { cn } from "@/lib/utils";
import { linkify } from "@/lib/linkify";
import { DatePicker } from "@/components/ui/DatePicker";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { PILL_GROUP_CLS, pillSegmentCls, pillSegmentSelectCls, PropertyPillBody } from "@/components/ui/PropertyPill";
import { CountryPopover } from "@/components/tasks/CountryPopover";
import { TaskSprintField } from "@/components/tasks/TaskSprintField";
import { PeoplePopover } from "@/components/tasks/PeoplePopover";
import { RecurrencePicker } from "@/components/tasks/RecurrencePicker";

const STATUSES: { id: string; label: string; en: string; icon: RoyIconName | "circle" }[] = [
  { id: "open", label: "Открыто", en: "Open", icon: "circle" },
  { id: "in_progress", label: "В работе", en: "In progress", icon: "clock" },
  { id: "done", label: "Готово", en: "Done", icon: "check" },
];

export const fieldCls =
  "w-full min-h-9 rounded-[8px] border border-line-2 bg-surface px-2.5 py-2 text-sm text-ink outline-none transition-[border-color,box-shadow] focus:border-primary focus:ring-3 focus:ring-accent-soft placeholder:text-ink-mute";

export const labelCls = "mb-1 block font-medium text-ink-soft";

// Rendering only: loading, selection rules and persistence remain in TaskModal.
type Setter<T> = Dispatch<SetStateAction<T>>;
interface TaskModalPropertiesProps {
  NONE: string;
  isEdit: boolean;
  task: Task | undefined;
  status: string;
  setStatus: Setter<string>;
  dueDate: string;
  setDueDate: Setter<string>;
  recur: RecurValue | null;
  setRecur: Setter<RecurValue | null>;
  recurAnchor: number | null | undefined;
  remindDate: string;
  setRemindDate: Setter<string>;
  remindedAt: string | null;
  setRemindedAt: Setter<string | null>;
  topProjectId: string | null;
  topProjectName: string | null;
  projectOptions: ProjectPickerOptions;
  subProjectId: string | null;
  subProjectName: string | null;
  subsOfTop: ProjectOption[];
  setSelProject: Setter<string | null>;
  onSaved: () => void;
  selectedCountryId: string;
  countryCodes: string[];
  setCountry: Setter<string>;
  people: Person[];
  assigneePersonIds: string[];
  pickAssignee: (ids: string[]) => void;
  addPerson: (name: string, email: string | null) => Promise<Person>;
  assigneeFallback: string[];
  coIds: string[];
  setCoIds: Setter<string[]>;
}



// Происхождение задачи: когда заведена и кем (владелец 2026-08-20: «не ясно, когда задача была
// закинута, и кто её создал»). Подвал под комментариями — там же, где обычно ищут историю.
// Дата полная (день-месяц-год): задачи живут дольше встреч, «10 авг.» без года двусмысленно.
// Автора может не быть у старых задач и у пришедших из встреч/бота — тогда молчим, а не пишем
// «неизвестно»: пустая строка честнее выдуманной.
export function TaskOrigin({ task }: { task: Task }) {
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

export function TaskModalProperties({ NONE, isEdit, task, status, setStatus, dueDate, setDueDate, recur, setRecur, recurAnchor, remindDate, setRemindDate, remindedAt, setRemindedAt, topProjectId, topProjectName, projectOptions, subProjectId, subProjectName, subsOfTop, setSelProject, onSaved, selectedCountryId, countryCodes, setCountry, people, assigneePersonIds, pickAssignee, addPerson, assigneeFallback, coIds, setCoIds }: TaskModalPropertiesProps) {
  const dt = useDt();
  return (<div data-card-block="props" className="flex flex-col gap-1.5">
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
                      className={cn(pillSegmentSelectCls(!!topProjectName), "h-auto max-w-full py-1")}
                    >
                      {/* Подпись считаем САМИ (base-ui Value в этой версии рисует сырое значение/UUID). */}
                      <RoyIcon name="board" size={14} strokeWidth={2} />
                      {topProjectName && <span className="min-w-0 whitespace-normal break-words text-left" style={{ fontSize: 12.5, lineHeight: 1.3 }}>{topProjectName}</span>}
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
                        className={cn(pillSegmentSelectCls(!!subProjectName), "h-auto max-w-full py-1")}
                      >
                        <RoyIcon name="cright" size={13} strokeWidth={2} />
                        {subProjectName && <span className="min-w-0 whitespace-normal break-words text-left" style={{ fontSize: 12.5, lineHeight: 1.3 }}>{subProjectName}</span>}
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

                {/* Спринт: где задача живёт сейчас и выбор другого — теми же правилами сервера, что у
                    доски спринтов (TaskSprintField). Только у существующей задачи; у закрытой,
                    отменённой и архивной поле прячется само. */}
                {isEdit && task && (
                  <TaskSprintField
                    task={{ id: task.id, title: task.title, due_date: dueDate || null, status, archived_at: task.archived_at }}
                    onChanged={() => onSaved()}
                  />
                )}

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
            </div>);
}

export function TaskHydrationNotice({ setHydrateAttempt }: { setHydrateAttempt: Setter<number> }) {
  const dt = useDt();
  return (<div
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
            </div>);
}

export function TaskDescription({ descEditing, description, isEdit, descHeight, descReadRef, setDescription, setDescEditing, startDescEdit }: {
  descEditing: boolean;
  description: string;
  isEdit: boolean;
  descHeight: number | null;
  descReadRef: RefObject<HTMLDivElement | null>;
  setDescription: Setter<string>;
  setDescEditing: Setter<boolean>;
  startDescEdit: () => void;
}) {
  const dt = useDt();
  return (<div data-card-block="description" className="flex flex-col">
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
            </div>);
}
