-- Порядок проектов и подпроектов на доске «Проекты» (issue #433).
--
-- До этого строки шли в порядке выборки (`order by created_at`), и выстроить их по смыслу было
-- нельзя: единственный способ подвинуть подпроект вверх — создать его заново. Владелец
-- 21.09.2026: «чтоб можно было подпроекты выстраивать в нужном порядке», оба уровня, порядок
-- общий для команды — значит он живёт у строки, а не в браузере.
--
-- `double precision`, а не `integer`: вставка между соседями считается как середина их позиций
-- (fractional indexing), поэтому одно перетаскивание — одна правка одной строки. Когда зазор
-- всё-таки кончается, приложение перенумеровывает братьев (miniapp/src/lib/projectOrder.ts).

alter table public.projects
  add column if not exists position double precision;

-- Бэкфилл: внутри своего родителя (у верхнего уровня родитель null) раскладываем по дате
-- создания тем же шагом, что использует приложение, — чтобы первая же перестановка имела
-- зазор и обошлась одной правкой. Идемпотентно: трогаем только строки без позиции.
with ordered as (
  select
    id,
    row_number() over (
      partition by group_id, parent_id
      order by created_at, id
    ) * 1000::double precision as pos
  from public.projects
  where position is null
)
update public.projects p
set position = ordered.pos
from ordered
where p.id = ordered.id
  and p.position is null;

comment on column public.projects.position is
  'Порядок в списке братьев (один родитель + один воркспейс), общий для команды. Меньше — выше. Вставка между соседями = середина их позиций; шаг по умолчанию 1000. NULL — строка ещё не размещена, показывается в хвосте по дате создания.';
