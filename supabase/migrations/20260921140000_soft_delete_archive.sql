-- Архивация вместо удаления: задачи, проекты, пространства, спринты.
--
-- Владелец 21.09.2026: «давай сделаем так, что у нас все что удаляется - не удаляется, а
-- архивируется. задачи, проекты, спринты в будущем. потом разберемся, но сейчас явно нужно».
--
-- Повод. Удаление в этом продукте уже сработало как тихая потеря данных: снос пространства
-- вынес из него ВСЕ проекты (`projects.sprint_id` стоит на `on delete set null`), раздел
-- «Проекты» опустел у всей команды, а восстанавливать раскладку пришлось по косвенному следу —
-- самих строк уже не было. Физическое удаление не оставляет шанса «посмотреть, как было».
--
-- Что здесь. Только колонки (аддитивно, безопасно). Поведение — в коде: DELETE-роуты проставляют
-- `archived_at`, выборки читают активное. Интерфейс пока не меняется: человек жмёт «Удалить»,
-- объект исчезает из списков — но лежит в базе и возвращается одним UPDATE.
--
-- Индексов намеренно НЕТ. Частичный индекс `where archived_at is null` окупается, когда условие
-- отсекает БОЛЬШУЮ часть строк; здесь наоборот — архив будет редким, почти все строки активны,
-- и такой индекс лишь повторит собой уже существующие, добавив цену на каждую запись. Появится
-- заметный архив — заведём тогда, по факту, а не на всякий случай.

alter table public.tasks
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by bigint;

alter table public.projects
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by bigint;

alter table public.sprints
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by bigint;

alter table public.sprint_cycles
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by bigint;

comment on column public.tasks.archived_at is
  'Момент архивации (мягкое удаление). NULL = живая. Физически задачи не удаляем — решение владельца 21.09.2026, issue #427.';
comment on column public.projects.archived_at is
  'Момент архивации (мягкое удаление). NULL = живой. Архивация проекта НЕ отвязывает его задачи и подпроекты — в отличие от прежнего DELETE.';
comment on column public.sprints.archived_at is
  'Момент архивации (мягкое удаление). NULL = живое. Архивация пространства НЕ обнуляет `projects.sprint_id` — именно это в сентябре 2026 и потеряло раскладку проектов.';
comment on column public.sprint_cycles.archived_at is
  'Момент архивации (мягкое удаление). NULL = живой спринт.';

-- Частичный уникальный индекс «в пространстве только один незакрытый спринт» должен считать
-- только ЖИВЫЕ спринты: архивный черновик со статусом draft/active иначе навсегда занимает
-- место, и человек упирается в «уже есть незакрытый спринт», не видя его нигде.
drop index if exists uniq_sprint_cycles_live_per_tab;
create unique index uniq_sprint_cycles_live_per_tab
  on public.sprint_cycles (tab_id)
  where status = any (array['draft'::text, 'active'::text])
    and tab_id is not null
    and archived_at is null;
