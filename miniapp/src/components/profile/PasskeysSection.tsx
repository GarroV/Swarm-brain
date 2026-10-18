"use client";
// Ключи входа в профиле и «Добавить устройство» (решение владельца 17.10.2026,
// docs/decisions/2026-10-17-passkey-add-device.md). Список своих ключей — устройство и дата;
// удалить ключ и выдать ссылку можно только там, где вход в этой сессии подтверждён ключом
// (иначе украденная сессия сняла бы ключи и завела свой). Ссылка и QR показываются только на экране —
// никому ничего не отправляется. Логика ссылки — lib/passkeyDevices.ts.
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { createDeviceLink, deleteMyPasskey, fetchMyPasskeys, type MyPasskey } from "@/lib/api";
import { deviceLinkUrl, keyDate } from "@/lib/passkeyDevices";
import { useDt, useLang } from "@/components/roy/nav";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";

type Link = { url: string; svg: string; expiresAt: string };

export function PasskeysSection() {
  const dt = useDt();
  const lang = useLang();
  const confirm = useConfirm();
  const [keys, setKeys] = useState<MyPasskey[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<Link | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetchMyPasskeys();
      setKeys(r.keys);
      setCanManage(r.can_manage);
      setError(null);
    } catch {
      setError(dt("Не удалось загрузить ключи.", "Couldn't load your keys."));
    }
  }, [dt]);

  useEffect(() => { void load(); }, [load]);

  async function addDevice(): Promise<void> {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const r = await createDeviceLink();
      const url = deviceLinkUrl(window.location.origin, r.token);
      const svg = await QRCode.toString(url, { errorCorrectionLevel: "M", margin: 2, type: "svg" });
      setLink({ url, svg, expiresAt: r.expires_at });
    } catch (e: unknown) {
      const status = (e as { status?: number }).status;
      setError(status === 429
        ? dt("Слишком много ссылок за час. Попробуйте позже.", "Too many links this hour. Try again later.")
        : dt("Не удалось выдать ссылку.", "Couldn't create the link."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(key: MyPasskey): Promise<void> {
    const ok = await confirm({
      title: dt("Удалить ключ?", "Remove this key?"),
      description: dt(
        `«${key.name}» больше не подтвердит вход. На этом устройстве ключ можно будет добавить заново.`,
        `“${key.name}” will no longer confirm sign-in. You can add a key on that device again later.`,
      ),
      confirmText: dt("Удалить", "Remove"),
    });
    if (!ok) return;
    try {
      await deleteMyPasskey(key.id);
      await load();
    } catch {
      setError(dt("Не удалось удалить ключ.", "Couldn't remove the key."));
    }
  }

  async function copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch { /* буфер закрыт — ссылку видно, её можно выделить */ }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {dt(
          "Ключ подтверждает вход отпечатком или лицом. У каждого устройства свой ключ.",
          "A key confirms sign-in with your fingerprint or face. Each device has its own key.",
        )}
      </p>

      {keys === null && !error && <p className="text-xs text-muted-foreground">{dt("Загрузка…", "Loading…")}</p>}
      {keys && keys.length === 0 && (
        <p className="text-xs text-muted-foreground">{dt("Ключей пока нет.", "No keys yet.")}</p>
      )}
      {keys && keys.length > 0 && (
        <ul className="divide-y divide-line rounded-[10px] border border-line">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{k.name}</div>
                <div className="text-xs text-muted-foreground">
                  {dt("Добавлен", "Added")} {keyDate(k.created_at, lang)}
                  {k.last_used_at ? ` · ${dt("вход", "last used")} ${keyDate(k.last_used_at, lang)}` : ""}
                </div>
              </div>
              {canManage && (
                <Button size="sm" variant="outline" onClick={() => void remove(k)}>
                  {dt("Удалить", "Remove")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage
        ? (
          <Button size="sm" onClick={() => void addDevice()} disabled={busy} className="w-full">
            {busy ? dt("Готовлю ссылку…", "Creating link…") : dt("Добавить устройство", "Add device")}
          </Button>
        )
        : keys && keys.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {dt(
              "Добавить устройство или удалить ключ можно там, где вход подтверждён ключом.",
              "You can add a device or remove a key where sign-in was confirmed with a key.",
            )}
          </p>
        )}

      {link && (
        <div className="space-y-2 rounded-[10px] border border-accent-line bg-surface px-3 py-3">
          <p className="text-xs text-ink">
            {dt(
              "Откройте ссылку на новом устройстве (наведите камеру на QR), войдите тем же аккаунтом и сохраните ключ. Ссылка одноразовая и действует 10 минут.",
              "Open the link on the new device (point its camera at the QR code), sign in with the same account and save the key. The link works once, for 10 minutes.",
            )}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- data-URI, оптимизировать нечего */}
          <img src={`data:image/svg+xml;utf8,${encodeURIComponent(link.svg)}`} alt={dt("QR-код ссылки", "Link QR code")}
            width={176} height={176} className="rounded-[8px] border border-line bg-white" />
          <div className="break-all font-mono text-ink-soft" style={{ fontSize: 11 }}>{link.url}</div>
          <Button size="sm" variant="outline" onClick={() => void copy(link.url)}>
            {copied ? dt("Скопировано", "Copied") : dt("Скопировать ссылку", "Copy link")}
          </Button>
        </div>
      )}

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
