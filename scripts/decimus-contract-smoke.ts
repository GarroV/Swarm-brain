// Сверка контракта Swarm ↔ Децимус на живых ответах (кнопка decimus-secrets.yml).
// Те же модули разбора, что в swarm-api / swarm-mcp, гоняются по ответам прод-Децимуса,
// сохранённым в файлы. Печатает только счётчики: данные пиццерий в лог публичного
// репозитория не попадают. Любая ошибка разбора — красный прогон.
//   deno run --allow-read scripts/decimus-contract-smoke.ts <каталог с *.json>
import { toView } from "../supabase/functions/swarm-api/quality-view.ts";
import { toMapsView } from "../supabase/functions/swarm-api/maps-view.ts";
import { toInspectionDetail, toInspectionsView } from "../supabase/functions/_shared/inspections-view.ts";

const dir = Deno.args[0];
if (!dir) throw new Error("нужен каталог с ответами");
const read = (name: string) => JSON.parse(Deno.readTextFileSync(`${dir}/${name}`));

const rs = toView("rs", read("scores.json"), null);
console.log(`РС: периодов ${rs.periods.length}, пиццерий ${rs.units.length}`);
const rko = toView("rko", read("scores-rko.json"), null);
console.log(`РКО: периодов ${rko.periods.length}, пиццерий ${rko.units.length}`);
const maps = toMapsView(read("maps.json"), null);
console.log(`Карты: стран ${maps.countries.length}, пиццерий ${maps.units.length}`);
const list = toInspectionsView(read("inspections.json"), null);
const withPrev = list.inspections.filter((i) => i.previous).length;
console.log(`Проверки: ${list.inspections.length}, с прошлой ${withPrev}, обрезано ${list.truncated}`);
if (list.inspections.length) {
  const d = toInspectionDetail(read("inspection.json"), null);
  if (!d) throw new Error("деталь первой проверки списка не разобралась");
  const titled = d.findings.filter((f) => f.title_ru || f.title_en).length;
  console.log(`Деталь: зон ${d.inspection.zones.length}, нарушений ${d.findings.length}, с названием пункта ${titled}`);
}
console.log("контракт сходится");
