"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useDt } from "@/components/roy/nav";

// QR-код для текста или адреса: превью и скачивание PNG / SVG (решение владельца 03.10.2026,
// issue #794). Код рисуется в браузере библиотекой `qrcode` — на сервер ничего не уходит.
// Уровень коррекции M (≈15% площади можно закрыть или испачкать) — стандарт для печати;
// поле в 2 модуля — меньше рекомендованных 4, но принтеры и сканеры телефонов его читают,
// а вокруг кода на листовке всё равно остаётся бумага.

const OPTS = { errorCorrectionLevel: "M", margin: 2 } as const;
const PNG_WIDTH = 1024; // хватает на печать A5 без лестницы

const safeName = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "qr";

function download(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
}

export function QrCard({ value, fileName }: { value: string; fileName: string }) {
  const dt = useDt();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!value) {
      setSvg(null);
      setFailed(false);
      return;
    }
    QRCode.toString(value, { ...OPTS, type: "svg" })
      .then((s) => { if (alive) { setSvg(s); setFailed(false); } })
      .catch((e: unknown) => {
        // Единственная ожидаемая причина — текст длиннее ёмкости кода.
        console.warn("[qr] не удалось построить код:", e instanceof Error ? e.message : e);
        if (alive) { setSvg(null); setFailed(true); }
      });
    return () => { alive = false; };
  }, [value]);

  if (failed) {
    return (
      <p className="text-ink-soft" style={{ fontSize: 13 }}>
        {dt("Слишком длинный текст для QR-кода. Сократите ссылку и сделайте код для короткой.", "Too long for a QR code. Shorten the link and make a code for the short one.")}
      </p>
    );
  }
  if (!svg) return null;

  const name = safeName(fileName);
  const savePng = async () => {
    try {
      download(await QRCode.toDataURL(value, { ...OPTS, width: PNG_WIDTH }), `${name}.png`);
    } catch (e: unknown) {
      console.warn("[qr] PNG не собрался:", e instanceof Error ? e.message : e);
    }
  };
  const saveSvg = () => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    download(url, `${name}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex flex-wrap items-end gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- data-URI, оптимизировать нечего */}
      <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt={dt("QR-код", "QR code")}
        width={176} height={176} className="rounded-[8px] border border-line bg-white" />
      <div className="flex flex-col gap-2">
        <button type="button" onClick={savePng}
          className="rounded-[8px] bg-ink px-3 py-1.5 font-semibold text-surface" style={{ fontSize: 13 }}>
          {dt("Скачать PNG", "Download PNG")}
        </button>
        <button type="button" onClick={saveSvg}
          className="rounded-[8px] border border-line px-3 py-1.5 text-ink" style={{ fontSize: 13 }}>
          {dt("Скачать SVG — для печати", "Download SVG — for print")}
        </button>
      </div>
    </div>
  );
}
