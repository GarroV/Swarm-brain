// Общее для стикеров главной: бумага (цвета фиксированные — стикер читается одинаково в светлой и
// тёмной теме, как настоящая бумажка) и подпись срока.
import type { StickerTone } from "@/types";

export const PAPER: Record<StickerTone, string> = {
  yellow: "bg-[#FFE97A] text-[#3A3000]",
  pink: "bg-[#FFC9DA] text-[#4A1426]",
  blue: "bg-[#C7E0FF] text-[#0E2A4D]",
  green: "bg-[#C9F0C4] text-[#173D14]",
  paper: "bg-[#FFFDF6] text-[#2A2A2A]",
};

/** Цвет образца в выборе цвета (без текста). */
export const SWATCH: Record<StickerTone, string> = {
  yellow: "#FFE97A", pink: "#FFC9DA", blue: "#C7E0FF", green: "#C9F0C4", paper: "#FFFDF6",
};

/** «12 окт, 18:00» в языке интерфейса; пустой или битый срок — пустая строка. */
export function fmtDue(iso: string | null, lang: "ru" | "en"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ru-RU", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(d);
}
