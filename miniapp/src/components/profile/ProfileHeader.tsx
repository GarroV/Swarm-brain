"use client";
import { Avatar } from "@/components/roy/ui";
import { RoyIcon } from "@/components/roy/icons";
import { useDt } from "@/components/roy/nav";
import { countryCode } from "@/lib/countries";
import type { Me } from "@/types";

const ROLE_LABEL: Record<string, string> = { bd: "BD", marketing: "Marketing", rnd: "R&D" };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Шапка профиля: кто я, одной строкой. Редактирование раскрывается по карандашу. */
export function ProfileHeader({ me, open, onToggle }: { me: Me; open: boolean; onToggle: () => void }) {
  const dt = useDt();
  const role = me.role ? ROLE_LABEL[me.role] ?? me.role : null;
  const shown = me.markets.slice(0, 8);
  const rest = me.markets.length - shown.length;

  return (
    <div className="flex items-start gap-3 rounded-[14px] border border-line bg-surface px-3 py-3 dark:backdrop-blur-sm">
      <Avatar size={36}>{initials(me.name)}</Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-ink" style={{ fontSize: 14, fontWeight: 600 }}>{me.name}</p>
        <p className="truncate text-ink-mute" style={{ fontSize: 11.5 }}>
          {[role, me.username ? `@${me.username}` : null].filter(Boolean).join(" · ") || dt("Роль не выбрана", "No role set")}
        </p>
        {shown.length > 0 && (
          <p className="mt-1.5 truncate text-ink-soft" style={{ fontSize: 11 }}>
            {shown.map(countryCode).join(" ")}{rest > 0 ? ` +${rest}` : ""}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={dt("Редактировать профиль", "Edit profile")}
        className="shrink-0 rounded-[10px] p-1.5 text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line"
      >
        <RoyIcon name="pencil" />
      </button>
    </div>
  );
}
