// ── Сокращатель ссылок («Полезности») ──────────────────────────────────────────
// Короткий адрес собирает экран: `${location.origin}/s/${code}` — переход обслуживает
// Pages Function functions/s/[code].ts.
export type ShortLink = {
  code: string;
  url: string;
  title: string | null;
  note: string | null;
  owner_id: number;
  owner_name: string;
  /** Автор или админ — сервер решает, экран только прячет кнопки. */
  can_manage: boolean;
  clicks: number;
  last_clicked_at: string | null;
  created_at: string;
};

export type ShortLinkMeta = { title: string; note: string };
