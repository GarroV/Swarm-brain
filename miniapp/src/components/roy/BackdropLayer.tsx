"use client";
import { useEffect, useRef, useState } from "react";
import { CUSTOM_BACKDROP_EVENT } from "@/lib/backdrop";
import { type CustomBackdrop, loadCustomBackdrop } from "@/lib/backdropStore";
import { useBackdrop } from "@/lib/useBackdrop";
import { GalaxyBackground } from "./GalaxyBackground";

// Слой фона ПОЗАДИ интерфейса (fixed, -z-10, pointer-events:none). Что рисовать — выбор
// пользователя (`lib/backdrop.ts`); прозрачность body/оболочки под фон — в globals.css
// по атрибуту `data-backdrop` на <html>.
export function BackdropLayer() {
  const id = useBackdrop();
  if (id === "galaxy") return <GalaxyBackground />;
  if (id === "custom") return <CustomImageLayer />;
  if (id === "dots" || id === "aurora") {
    return <div aria-hidden className={`roy-backdrop roy-backdrop-${id}`} />;
  }
  return null;
}

// Своя картинка из IndexedDB. На этом устройстве её нет (выбрали на другом, или хранилище
// недоступно) — показываем фон по умолчанию, а не пустоту.
function CustomImageLayer() {
  const [rec, setRec] = useState<CustomBackdrop | null | undefined>(undefined);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const reload = () => { void loadCustomBackdrop().then((r) => { if (alive) setRec(r); }); };
    reload();
    window.addEventListener(CUSTOM_BACKDROP_EVENT, reload);
    return () => { alive = false; window.removeEventListener(CUSTOM_BACKDROP_EVENT, reload); };
  }, []);

  // URL — от самой картинки, а не от записи: ползунки затемнения/размытия пересохраняют запись,
  // IndexedDB отдаёт новый Blob, и без ключа картинка перекодировалась бы на каждый сдвиг (мигание).
  const imageKey = rec ? `${rec.name}|${rec.blob.size}|${rec.width}x${rec.height}` : null;
  const blobRef = useRef<Blob | null>(null);
  blobRef.current = rec?.blob ?? null;
  useEffect(() => {
    const blob = blobRef.current;
    if (!imageKey || !blob) { setUrl(null); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [imageKey]);

  if (rec === undefined) return null; // ещё читаем хранилище — не мигаем галактикой
  if (!rec || !url) return <GalaxyBackground />;
  return (
    <div aria-hidden className="roy-backdrop overflow-hidden">
      <div
        className="roy-backdrop-image absolute inset-0"
        style={{
          backgroundImage: `url("${url}")`,
          filter: rec.blur > 0 ? `blur(${rec.blur}px)` : undefined,
          transform: rec.blur > 0 ? "scale(1.08)" : undefined,
        }}
      />
      <div className="roy-backdrop-dim absolute inset-0" style={{ opacity: rec.dim / 100 }} />
    </div>
  );
}
