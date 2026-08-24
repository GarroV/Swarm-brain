"use client";
// Рынки записи — плотная сетка чипов «флаг + код» с мультивыбором (issue #73).
//
// Зачем блоком, а не поповером (как CountryPopover у задач): владелец не видел, что рынок
// вообще где-то выставляется («до сих пор не вижу возможности настройки стран»), поэтому
// выбор должен быть на виду рядом с кнопкой решения, а не спрятан за триггером. Чип «Общее» —
// не страна, а явный сентинел «конкретного рынка нет»: включается вместо стран и сбрасывает их.
import { countryCode, countryFlag, countryName } from "@/lib/countries";
import { RoyIcon } from "@/components/roy/icons";

export function MarketChips({
  codes,
  value,
  onChange,
  disabled = false,
}: {
  codes: string[];              // рынки воркспейса (/config allowed_markets)
  value: string[];              // выбранные ISO-коды; пустой массив = «Общее»
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const selected = value.map(countryCode);
  const isGeneral = selected.length === 0;

  const toggle = (code: string) => {
    const c = countryCode(code);
    onChange(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);
  };

  const chip = (active: boolean) =>
    `inline-flex items-center gap-1 rounded-full border px-2 py-1 font-semibold transition-colors disabled:opacity-50 ${
      active
        ? "border-primary bg-accent-soft text-accent-ink"
        : "border-line-2 bg-surface text-ink-soft hover:bg-surface-2"
    }`;

  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([])}
        title="Без конкретного рынка"
        className={chip(isGeneral)}
        style={{ fontSize: 12 }}
      >
        <RoyIcon name="globe" size={13} strokeWidth={1.9} />
        Общее
      </button>
      {codes.map((code) => (
        <button
          key={code}
          type="button"
          disabled={disabled}
          onClick={() => toggle(code)}
          title={countryName(code)}
          className={chip(selected.includes(countryCode(code)))}
          style={{ fontSize: 12 }}
        >
          <span style={{ fontSize: 12 }}>{countryFlag(code)}</span>
          {countryCode(code)}
        </button>
      ))}
    </div>
  );
}
