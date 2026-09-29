// Запись `meetings.recorders` — условной UPDATE по прочитанному значению, с повтором.
//
// Список раньше писался «прочитал → изменил → записал» без условия: одновременные claim двух
// людей или сверка претендента в meeting-ingest (она читает строку, долго меряет выгрузку и
// пишет список обратно) стирали строку, вписанную соседом. Пока список был справкой, это
// терпели; с T160 роль `challenger` в нём даёт право выгрузки, и стёртая строка — отказ 403
// человеку, чья запись могла быть полнее. Колонку-на-человека схема не даёт, поэтому — оптимистичная
// запись: UPDATE проходит, только если в строке всё ещё то, что прочитано; иначе перечитать и
// применить изменение заново. jsonb сравнивается по значению, порядок ключей не важен.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_ATTEMPTS = 5;

/**
 * Применить `mutate` к текущему списку. `mutate` возвращает новый список или null — «менять
 * нечего». `extra` едет той же UPDATE. true — записано (или менять было нечего); false — строки
 * нет или гонка не кончилась за MAX_ATTEMPTS попыток.
 */
export async function updateRecorders(
  supabase: SupabaseClient,
  meetingId: string,
  mutate: (current: unknown[]) => unknown[] | null,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data, error } = await supabase.from("meetings").select("recorders").eq("id", meetingId).maybeSingle();
    if (error) throw new Error(`recorders ${meetingId}: ${error.message}`);
    if (!data) return false;
    const current = (data as { recorders: unknown }).recorders;
    const next = mutate(Array.isArray(current) ? current : []);
    if (next === null) return true;
    const base = supabase.from("meetings").update({ ...extra, recorders: next }).eq("id", meetingId);
    const guarded = current === null || current === undefined
      ? base.is("recorders", null)
      : base.eq("recorders", JSON.stringify(current));
    const { data: hit, error: werr } = await guarded.select("id");
    if (werr) throw new Error(`recorders ${meetingId}: ${werr.message}`);
    if ((hit ?? []).length > 0) return true;
  }
  console.error(`recorders ${meetingId}: список менялся на каждой из ${MAX_ATTEMPTS} попыток — запись не сделана`);
  return false;
}
