# Super Admin Panel + Country Normalization

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize all country/market values to ISO-3166-1 alpha-2 codes throughout the system, and add a super admin Mini App screen (only for `telegram_id = 744230399`) for managing workspace users and per-workspace market lists.

**Architecture:**  
Phase 1 (Normalization): `_shared/countries.ts` defines the canonical code→name map and `normalizeCountry()`. All 4 GPT extraction paths + `PATCH /me` normalize before DB writes. One SQL migration normalizes existing data. `GET /config` exposes workspace's allowed market codes to the Mini App. Frontend chip picker uses ISO codes as keys, maps to Russian names for display.  
Phase 2 (Admin API): New `swarm-api/admin.ts` handles `/admin/*` gated to `telegram_id === 744230399`. Manages workspaces (user CRUD) and `workspaces.allowed_markets`.  
Phase 3 (Admin UI): `AdminScreen.tsx` — new Mini App tab shown only when `me.is_admin === true`. Two inner tabs: Пользователи (workspace + user CRUD) and Рынки (per-workspace market config).

**Tech Stack:** Deno TypeScript (Edge Functions), Supabase Postgres, Next.js 15, shadcn/ui, Lucide icons

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/functions/_shared/countries.ts` | **Create** | Canonical code↔name map + `normalizeCountry()` |
| `miniapp/src/lib/countries.ts` | **Create** | Display-only code→name map for frontend |
| `supabase/migrations/20260603000000_workspace_markets.sql` | **Create** | Add `allowed_markets text[]` to `workspaces` |
| `supabase/migrations/20260603000001_normalize_countries_data.sql` | **Create** | Normalize existing `entries.countries` + `user_profiles.markets` values |
| `supabase/functions/swarm-bot/lib/storage.ts` | **Modify** | Import `normalizeCountries`, apply to `extractEntryMeta` output |
| `supabase/functions/read-ai-webhook/index.ts` | **Modify** | Import `normalizeCountries`, apply to `extractCountries` output |
| `supabase/functions/swarm-api/index.ts` | **Modify** | Normalize in POST /entries; add `GET /config`; import `handleAdminRoutes` |
| `supabase/functions/swarm-mcp/index.ts` | **Modify** | Import `normalizeCountries`, apply to local `extractEntryMeta` |
| `supabase/functions/swarm-api/admin.ts` | **Create** | All `/admin/*` route handlers |
| `miniapp/src/types.ts` | **Modify** | Add `is_admin` to `Me`; add `AdminWorkspace`, `AdminUser` types |
| `miniapp/src/lib/api.ts` | **Modify** | Add `fetchConfig()` + all admin API functions |
| `miniapp/src/components/SettingsScreen.tsx` | **Modify** | Load chips from `GET /config`; use ISO codes in state; map to names for display |
| `miniapp/src/components/AdminScreen.tsx` | **Create** | Full super admin UI |
| `miniapp/src/components/BottomNav.tsx` | **Modify** | Conditional 6th tab for admin |
| `miniapp/src/app/page.tsx` | **Modify** | Render `AdminScreen` when `section === "admin"` |

---

## Phase 1 — Country Registry & Normalization

### Task 1: Create `_shared/countries.ts`

**Files:** Create `supabase/functions/_shared/countries.ts`

- [ ] **Step 1: Create the file**

```typescript
// supabase/functions/_shared/countries.ts

export const COUNTRY_NAMES: Record<string, string> = {
  RS: "Сербия",
  HR: "Хорватия",
  SI: "Словения",
  ME: "Черногория",
  BG: "Болгария",
  ES: "Испания",
  RO: "Румыния",
  PL: "Польша",
  EE: "Эстония",
  LT: "Литва",
  CY: "Кипр",
  HU: "Венгрия",
  MD: "Молдова",
  BY: "Беларусь",
  TR: "Турция",
  AZ: "Азербайджан",
  AM: "Армения",
  GE: "Грузия",
  TJ: "Таджикистан",
  KG: "Кыргызстан",
  MN: "Монголия",
  NG: "Нигерия",
  MX: "Мексика",
  ID: "Бали/Индонезия",
  RU: "Россия",
  UA: "Украина",
  KZ: "Казахстан",
};

// All known aliases → ISO code (lowercase key for case-insensitive lookup)
const ALIASES: Record<string, string> = {
  // Serbian
  "сербия": "RS", "serbia": "RS",
  // Croatian
  "хорватия": "HR", "croatia": "HR",
  // Slovenian
  "словения": "SI", "slovenia": "SI",
  // Montenegrin
  "черногория": "ME", "montenegro": "ME",
  // Bulgarian
  "болгария": "BG", "bulgaria": "BG",
  // Spanish
  "испания": "ES", "spain": "ES", "(испания)": "ES",
  // Romanian
  "румыния": "RO", "romania": "RO",
  // Polish
  "польша": "PL", "poland": "PL",
  // Estonian
  "эстония": "EE", "estonia": "EE",
  // Lithuanian
  "литва": "LT", "lithuania": "LT",
  // Cypriot
  "кипр": "CY", "cyprus": "CY",
  // Hungarian
  "венгрия": "HU", "hungary": "HU",
  // Moldovan
  "молдова": "MD", "moldova": "MD",
  // Belarusian
  "беларусь": "BY", "belarus": "BY",
  // Turkish
  "турция": "TR", "turkey": "TR",
  // Azerbaijani
  "азербайджан": "AZ", "azerbaijan": "AZ",
  // Armenian
  "армения": "AM", "armenia": "AM",
  // Georgian
  "грузия": "GE", "georgia": "GE",
  // Tajik
  "таджикистан": "TJ", "tajikistan": "TJ",
  // Kyrgyz
  "кыргызстан": "KG", "kyrgyzstan": "KG",
  // Mongolian
  "монголия": "MN", "mongolia": "MN",
  // Nigerian
  "нигерия": "NG", "nigeria": "NG",
  // Mexican
  "мексика": "MX", "mexico": "MX",
  // Indonesian / Bali
  "бали": "ID", "bali": "ID", "индонезия": "ID", "indonesia": "ID",
  // Russian
  "россия": "RU", "russia": "RU",
  // Ukrainian
  "украина": "UA", "ukraine": "UA",
  // Kazakh
  "казахстан": "KZ", "kazakhstan": "KZ",
};

/**
 * Normalize a single country name to ISO code.
 * Returns the ISO code if recognized, null if unknown.
 * Already-valid ISO codes (e.g., "RS") are returned as-is.
 */
export function normalizeCountry(raw: string): string | null {
  const trimmed = raw.trim();
  // Already a valid code?
  if (COUNTRY_NAMES[trimmed.toUpperCase()]) return trimmed.toUpperCase();
  // Alias lookup (case-insensitive)
  return ALIASES[trimmed.toLowerCase()] ?? null;
}

/**
 * Normalize an array of country names, dropping unrecognized values.
 */
export function normalizeCountries(raw: string[]): string[] {
  return [...new Set(raw.map(normalizeCountry).filter((c): c is string => c !== null))];
}
```

- [ ] **Step 2: Verify TypeScript is valid** (no Deno-specific imports, pure TypeScript)

No deploy needed yet — this file is imported by others.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/countries.ts
git commit -m "feat(countries): canonical ISO code list + normalizeCountries()"
```

---

### Task 2: Create `miniapp/src/lib/countries.ts`

**Files:** Create `miniapp/src/lib/countries.ts`

- [ ] **Step 1: Create the file**

```typescript
// miniapp/src/lib/countries.ts
// Display-only: code → Russian name. Keep in sync with _shared/countries.ts.

export const COUNTRY_NAMES: Record<string, string> = {
  RS: "Сербия",  HR: "Хорватия",  SI: "Словения",  ME: "Черногория",
  BG: "Болгария", ES: "Испания",   RO: "Румыния",   PL: "Польша",
  EE: "Эстония", LT: "Литва",     CY: "Кипр",      HU: "Венгрия",
  MD: "Молдова",  BY: "Беларусь",  TR: "Турция",    AZ: "Азербайджан",
  AM: "Армения",  GE: "Грузия",    TJ: "Таджикистан", KG: "Кыргызстан",
  MN: "Монголия", NG: "Нигерия",   MX: "Мексика",   ID: "Бали/Индонезия",
  RU: "Россия",   UA: "Украина",   KZ: "Казахстан",
};

/** Returns Russian display name for a code, or the code itself if unknown. */
export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd /Users/garva/swarm/miniapp && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to `countries.ts`.

- [ ] **Step 3: Commit**

```bash
git add miniapp/src/lib/countries.ts
git commit -m "feat(miniapp): frontend country code→name lookup"
```

---

### Task 3: DB migration — `workspaces.allowed_markets`

**Files:** Create `supabase/migrations/20260603000000_workspace_markets.sql`

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/20260603000000_workspace_markets.sql
-- Add allowed_markets to workspaces.
-- NULL means "use global list from _shared/countries.ts".
-- Non-null means this workspace restricts to these ISO codes only.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS allowed_markets text[] DEFAULT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO service_role;
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

Expected output: `Applying migration 20260603000000_workspace_markets.sql`

- [ ] **Step 3: Verify**

```bash
supabase db execute --sql "SELECT id, name, allowed_markets FROM workspaces;"
```

Expected: rows with `allowed_markets = NULL` for all existing workspaces.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260603000000_workspace_markets.sql
git commit -m "feat(db): add allowed_markets to workspaces"
```

---

### Task 4: Data migration — normalize existing stored values

**Files:** Create `supabase/migrations/20260603000001_normalize_countries_data.sql`

> ⚠️ This is a one-time data fix. It converts existing free-text values to ISO codes. Unknown values are kept as-is so no data is lost.

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/20260603000001_normalize_countries_data.sql
-- One-time normalization of entries.countries and user_profiles.markets to ISO codes.

-- Helper: map a single raw value to ISO code (returns original if unknown)
CREATE OR REPLACE FUNCTION _normalize_country_once(raw text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(trim(raw))
    WHEN 'сербия'        THEN 'RS' WHEN 'serbia'       THEN 'RS'
    WHEN 'хорватия'      THEN 'HR' WHEN 'croatia'      THEN 'HR'
    WHEN 'словения'      THEN 'SI' WHEN 'slovenia'     THEN 'SI'
    WHEN 'черногория'    THEN 'ME' WHEN 'montenegro'   THEN 'ME'
    WHEN 'болгария'      THEN 'BG' WHEN 'bulgaria'     THEN 'BG'
    WHEN 'испания'       THEN 'ES' WHEN 'spain'        THEN 'ES'
    WHEN '(испания)'     THEN 'ES'
    WHEN 'румыния'       THEN 'RO' WHEN 'romania'      THEN 'RO'
    WHEN 'польша'        THEN 'PL' WHEN 'poland'       THEN 'PL'
    WHEN 'эстония'       THEN 'EE' WHEN 'estonia'      THEN 'EE'
    WHEN 'литва'         THEN 'LT' WHEN 'lithuania'    THEN 'LT'
    WHEN 'кипр'          THEN 'CY' WHEN 'cyprus'       THEN 'CY'
    WHEN 'венгрия'       THEN 'HU' WHEN 'hungary'      THEN 'HU'
    WHEN 'молдова'       THEN 'MD' WHEN 'moldova'      THEN 'MD'
    WHEN 'беларусь'      THEN 'BY' WHEN 'belarus'      THEN 'BY'
    WHEN 'турция'        THEN 'TR' WHEN 'turkey'       THEN 'TR'
    WHEN 'азербайджан'   THEN 'AZ' WHEN 'azerbaijan'  THEN 'AZ'
    WHEN 'армения'       THEN 'AM' WHEN 'armenia'      THEN 'AM'
    WHEN 'грузия'        THEN 'GE' WHEN 'georgia'      THEN 'GE'
    WHEN 'таджикистан'   THEN 'TJ' WHEN 'tajikistan'   THEN 'TJ'
    WHEN 'кыргызстан'    THEN 'KG' WHEN 'kyrgyzstan'   THEN 'KG'
    WHEN 'монголия'      THEN 'MN' WHEN 'mongolia'     THEN 'MN'
    WHEN 'нигерия'       THEN 'NG' WHEN 'nigeria'      THEN 'NG'
    WHEN 'мексика'       THEN 'MX' WHEN 'mexico'       THEN 'MX'
    WHEN 'бали'          THEN 'ID' WHEN 'bali'         THEN 'ID'
    WHEN 'россия'        THEN 'RU' WHEN 'russia'       THEN 'RU'
    WHEN 'украина'       THEN 'UA' WHEN 'ukraine'      THEN 'UA'
    WHEN 'казахстан'     THEN 'KZ' WHEN 'kazakhstan'   THEN 'KZ'
    ELSE trim(raw)  -- keep as-is if unknown
  END;
$$;

-- Normalize entries.countries
UPDATE public.entries
SET countries = ARRAY(
  SELECT DISTINCT _normalize_country_once(c)
  FROM unnest(countries) c
  WHERE c IS NOT NULL AND trim(c) <> ''
)
WHERE array_length(countries, 1) > 0;

-- Normalize user_profiles.markets
UPDATE public.user_profiles
SET markets = ARRAY(
  SELECT DISTINCT _normalize_country_once(m)
  FROM unnest(markets) m
  WHERE m IS NOT NULL AND trim(m) <> ''
)
WHERE array_length(markets, 1) > 0;

-- Clean up helper function (one-time use)
DROP FUNCTION IF EXISTS _normalize_country_once(text);
```

- [ ] **Step 2: Preview before applying (dry run)**

```bash
supabase db execute --sql "
SELECT countries FROM entries WHERE array_length(countries,1) > 0 LIMIT 5;
SELECT markets FROM user_profiles WHERE array_length(markets,1) > 0;"
```

Verify the current values look as expected before migration.

- [ ] **Step 3: Apply migration**

```bash
supabase db push
```

- [ ] **Step 4: Verify normalized values**

```bash
supabase db execute --sql "
SELECT DISTINCT unnest(countries) AS c FROM entries ORDER BY c;
SELECT DISTINCT unnest(markets) AS m FROM user_profiles ORDER BY m;"
```

Expected: only ISO codes like `RS`, `HR`, `BY`, `PL` etc. Any unrecognized values will appear as-is (e.g. old free-text that has no mapping yet — inspect and add to the ALIASES map in `_shared/countries.ts` if needed).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260603000001_normalize_countries_data.sql
git commit -m "feat(db): one-time migration — normalize countries to ISO codes"
```

---

### Task 5: Normalize in `swarm-bot/lib/storage.ts`

**Files:** Modify `supabase/functions/swarm-bot/lib/storage.ts`

`extractEntryMeta` (lines 10-27) runs GPT and returns `{ countries: string[], ... }`. After GPT returns, we normalize.

- [ ] **Step 1: Add import at top of file**

```typescript
import { normalizeCountries } from "../../_shared/countries.ts";
```

- [ ] **Step 2: Apply normalization after GPT parse in `extractEntryMeta`**

Find the `return` statement of `extractEntryMeta` (the one that returns the parsed JSON object). Wrap the `countries` field:

```typescript
// Before:
return { countries: parsed.countries ?? [], entry_type: parsed.entry_type ?? "note", entry_date: parsed.entry_date ?? null };

// After:
return { countries: normalizeCountries(parsed.countries ?? []), entry_type: parsed.entry_type ?? "note", entry_date: parsed.entry_date ?? null };
```

- [ ] **Step 3: Deploy**

```bash
supabase functions deploy swarm-bot --no-verify-jwt
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/swarm-bot/lib/storage.ts
git commit -m "feat(bot): normalize extracted countries to ISO codes"
```

---

### Task 6: Normalize in `read-ai-webhook/index.ts`

**Files:** Modify `supabase/functions/read-ai-webhook/index.ts`

`extractCountries` (lines 66-76) returns `string[]` from GPT.

- [ ] **Step 1: Add import**

```typescript
import { normalizeCountries } from "../_shared/countries.ts";
```

- [ ] **Step 2: Wrap return value in `extractCountries`**

```typescript
// Before:
return parsed.countries ?? [];

// After:
return normalizeCountries(parsed.countries ?? []);
```

- [ ] **Step 3: Deploy**

```bash
supabase functions deploy read-ai-webhook --no-verify-jwt
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/read-ai-webhook/index.ts
git commit -m "feat(read-ai): normalize extracted countries to ISO codes"
```

---

### Task 7: Normalize in `swarm-api/index.ts` (POST /entries inline GPT)

**Files:** Modify `supabase/functions/swarm-api/index.ts`

The inline GPT call at lines ~448-465 parses a `countries` array from GPT output. Normalize before use.

- [ ] **Step 1: Add import at top of `index.ts`**

```typescript
import { normalizeCountries } from "../_shared/countries.ts";
```

- [ ] **Step 2: Find the `meta.countries` assignment after GPT parse (around line 465) and wrap it**

```typescript
// Before:
let meta: { countries: string[]; entry_type: string; entry_date: string | null } = { countries: [], entry_type: "note", entry_date: null };
try { meta = JSON.parse(gptReply); } catch { /* keep defaults */ }

// After:
let meta: { countries: string[]; entry_type: string; entry_date: string | null } = { countries: [], entry_type: "note", entry_date: null };
try {
  const parsed = JSON.parse(gptReply);
  meta = { ...parsed, countries: normalizeCountries(parsed.countries ?? []) };
} catch { /* keep defaults */ }
```

- [ ] **Step 3: Also normalize `countries` in PATCH /entries (around line 546) and PATCH /meetings**

```typescript
// PATCH /entries — find where body.countries is accepted:
if ("countries" in body && Array.isArray(body.countries))
  fields.countries = normalizeCountries(body.countries as string[]);

// PATCH /meetings — same pattern (already added, update it):
if ("countries" in body && Array.isArray(body.countries))
  fields.countries = normalizeCountries(body.countries as string[]);
```

- [ ] **Step 4: Normalize PATCH /me markets**

Find `PATCH /me` handler (around line 323). Add normalization before DB write:

```typescript
// In PATCH /me handler, before the .update() call:
const { role, markets } = body as { role?: string | null; markets?: string[] };
const fields: Record<string, unknown> = {};
if ("role" in body) fields.role = role ?? null;
if ("markets" in body && Array.isArray(markets)) fields.markets = normalizeCountries(markets);
if (!Object.keys(fields).length) return json({ ok: true }, 200, origin);
await supabase.from("user_profiles").update(fields).eq("telegram_id", telegram_id);
return json({ ok: true }, 200, origin);
```

> Note: read the current PATCH /me handler carefully before editing — the exact structure may differ slightly. The key change is wrapping `markets` with `normalizeCountries()`.

- [ ] **Step 5: Commit (no deploy yet — wait for GET /config in Task 8)**

```bash
git add supabase/functions/swarm-api/index.ts
git commit -m "feat(api): normalize countries/markets to ISO codes on all write paths"
```

---

### Task 8: Normalize in `swarm-mcp/index.ts`

**Files:** Modify `supabase/functions/swarm-mcp/index.ts`

`swarm-mcp` has its own copy of `extractEntryMeta` (lines 57-67). Add normalization there.

- [ ] **Step 1: Add import**

```typescript
import { normalizeCountries } from "../_shared/countries.ts";
```

- [ ] **Step 2: Wrap `countries` in return value of local `extractEntryMeta`**

Find the `return` statement of the local `extractEntryMeta` function (around line 64):

```typescript
// Before:
return { countries: parsed.countries ?? [], ... };

// After:
return { countries: normalizeCountries(parsed.countries ?? []), ... };
```

- [ ] **Step 3: Deploy mcp**

```bash
supabase functions deploy swarm-mcp --no-verify-jwt
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/swarm-mcp/index.ts
git commit -m "feat(mcp): normalize extracted countries to ISO codes"
```

---

### Task 9: `GET /config` endpoint in `swarm-api`

**Files:** Modify `supabase/functions/swarm-api/index.ts`

Returns the list of allowed market codes for the current workspace. Falls back to all known codes if workspace has no custom list.

- [ ] **Step 1: Add import for `COUNTRY_NAMES` at top of `index.ts`**

```typescript
import { COUNTRY_NAMES } from "../_shared/countries.ts";
```

(Already have `normalizeCountries` from Task 7.)

- [ ] **Step 2: Add the route after `GET /me` (around line 146)**

```typescript
// GET /config
if (req.method === "GET" && routePath === "/config") {
  const { data: ws } = await supabase
    .from("workspaces")
    .select("allowed_markets")
    .eq("id", groupId)
    .maybeSingle();
  const allowedMarkets = (ws as { allowed_markets: string[] | null } | null)?.allowed_markets;
  const markets = allowedMarkets ?? Object.keys(COUNTRY_NAMES);
  return json({ allowed_markets: markets }, 200, origin);
}
```

- [ ] **Step 3: Deploy swarm-api**

```bash
supabase functions deploy swarm-api --no-verify-jwt
```

- [ ] **Step 4: Test endpoint**

Open mini app or use curl with a valid `tma` token. GET `/config` should return `{ "allowed_markets": ["RS","HR",...] }`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/swarm-api/index.ts
git commit -m "feat(api): GET /config returns workspace allowed_markets"
```

---

### Task 10: Update `SettingsScreen` — chips use ISO codes + load from `/config`

**Files:** Modify `miniapp/src/components/SettingsScreen.tsx`

The chip picker currently has hardcoded Russian names as values. Change it to use ISO codes as state values, Russian names only for display, and load the allowed list from `GET /config`.

- [ ] **Step 1: Add imports**

```typescript
import { countryName } from "@/lib/countries";
import { fetchConfig } from "@/lib/api";
```

- [ ] **Step 2: Add `fetchConfig` to `api.ts` (preview — full api.ts changes in Task 13)**

```typescript
// In miniapp/src/lib/api.ts
export async function fetchConfig(): Promise<{ allowed_markets: string[] }> {
  if (DEV_MODE) return { allowed_markets: ["RS","HR","SI","ME","BG","ES","RO","PL","EE","LT","CY","HU","MD","BY","TR","AZ","AM","GE","TJ","KG","MN","NG","MX","ID"] };
  return apiFetch<{ allowed_markets: string[] }>("/config");
}
```

- [ ] **Step 3: Rewrite `ProfileSection` chip section**

Replace the entire `MARKETS_EUROPE`, `MARKETS_OTHER`, `normalizeMarket` constants and the markets state initialization:

```typescript
// Remove MARKETS_EUROPE, MARKETS_OTHER, ALL_MARKETS, normalizeMarket from the file.

// ProfileSection state now:
const [markets, setMarkets] = useState<string[]>(me.markets);  // already ISO codes from API
const [allowedMarkets, setAllowedMarkets] = useState<string[]>([]);
const [marketsLoading, setMarketsLoading] = useState(true);

useEffect(() => {
  fetchConfig()
    .then(c => setAllowedMarkets(c.allowed_markets))
    .finally(() => setMarketsLoading(false));
}, []);
```

- [ ] **Step 4: Update the chips render section**

```tsx
<div>
  <Label className="text-xs">Рынки</Label>
  {marketsLoading ? (
    <p className="text-xs text-muted-foreground mt-2">Загрузка…</p>
  ) : (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {allowedMarkets.map((code) => (
        <button
          key={code}
          onClick={() => setMarkets(prev =>
            prev.includes(code) ? prev.filter(x => x !== code) : [...prev, code]
          )}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            markets.includes(code)
              ? "bg-primary text-primary-foreground border-primary"
              : "text-muted-foreground border-border"
          }`}
        >
          {countryName(code)}
        </button>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 5: `handleSave` already sends `markets` (ISO code array) — no change needed**

```typescript
await patchMe({ role: role || null, markets });
// markets is already string[] of ISO codes
```

- [ ] **Step 6: Build check**

```bash
cd /Users/garva/swarm/miniapp && npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add miniapp/src/components/SettingsScreen.tsx miniapp/src/lib/api.ts
git commit -m "feat(miniapp): markets chips load from /config, store ISO codes"
```

---

## Phase 2 — Super Admin API

### Task 11: Create `swarm-api/admin.ts` — scaffold + auth gate

**Files:** Create `supabase/functions/swarm-api/admin.ts`

- [ ] **Step 1: Create the file**

```typescript
// supabase/functions/swarm-api/admin.ts
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeCountries } from "../_shared/countries.ts";

const ADMIN_TELEGRAM_ID = 744230399;

function json(data: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

function apiErr(status: number, msg: string, origin: string) {
  return json({ error: msg }, status, origin);
}

/**
 * Handle all /admin/* routes.
 * Returns a Response if the route matched, null otherwise.
 * Returns 403 immediately if caller is not the super admin.
 */
export async function handleAdminRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  telegramId: number,
  origin: string,
): Promise<Response | null> {
  if (!routePath.startsWith("/admin")) return null;

  if (telegramId !== ADMIN_TELEGRAM_ID) {
    return apiErr(403, "Forbidden", origin);
  }

  // GET /admin/workspaces
  if (req.method === "GET" && routePath === "/admin/workspaces") {
    const { data: workspaces } = await supabase
      .from("workspaces")
      .select("id, name, allowed_markets");

    const { data: userCounts } = await supabase
      .from("allowed_users")
      .select("group_id");

    const countMap: Record<string, number> = {};
    for (const row of (userCounts ?? []) as Array<{ group_id: string }>) {
      if (row.group_id) countMap[row.group_id] = (countMap[row.group_id] ?? 0) + 1;
    }

    const result = (workspaces ?? []).map((ws: Record<string, unknown>) => ({
      ...ws,
      user_count: countMap[ws.id as string] ?? 0,
    }));
    return json(result, 200, origin);
  }

  // GET /admin/workspaces/:id/users
  const wsUsersMatch = routePath.match(/^\/admin\/workspaces\/([^/]+)\/users$/);
  if (wsUsersMatch) {
    const wsId = wsUsersMatch[1];

    if (req.method === "GET") {
      const { data: users } = await supabase
        .from("allowed_users")
        .select("telegram_id, username, is_admin, created_at")
        .eq("group_id", wsId);

      const ids = (users ?? [])
        .filter((u: Record<string, unknown>) => u.telegram_id != null)
        .map((u: Record<string, unknown>) => u.telegram_id as number);

      const { data: profiles } = ids.length
        ? await supabase.from("user_profiles").select("telegram_id, first_name, last_name, role, markets").in("telegram_id", ids)
        : { data: [] };

      const profileMap = Object.fromEntries(
        (profiles ?? []).map((p: Record<string, unknown>) => [p.telegram_id, p])
      );

      const result = (users ?? [])
        .filter((u: Record<string, unknown>) => u.telegram_id != null)
        .map((u: Record<string, unknown>) => {
          const p = profileMap[u.telegram_id as number] as Record<string, unknown> | undefined;
          const fullName = p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : null;
          return {
            telegram_id: u.telegram_id,
            name: fullName || u.username || String(u.telegram_id),
            username: u.username ?? null,
            is_admin: u.is_admin ?? false,
            role: p?.role ?? null,
            markets: p?.markets ?? [],
            created_at: u.created_at,
          };
        });

      return json(result, 200, origin);
    }

    if (req.method === "POST") {
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }

      const telegramIdToAdd = body.telegram_id as number | undefined;
      const usernameToAdd = body.username as string | undefined;

      if (!telegramIdToAdd && !usernameToAdd) return apiErr(400, "telegram_id or username required", origin);

      if (telegramIdToAdd) {
        await supabase.from("allowed_users").upsert(
          { telegram_id: telegramIdToAdd, group_id: wsId, added_by: ADMIN_TELEGRAM_ID },
          { onConflict: "telegram_id" }
        );
      } else {
        await supabase.from("allowed_users").upsert(
          { username: usernameToAdd, group_id: wsId, added_by: ADMIN_TELEGRAM_ID },
          { onConflict: "username" }
        );
      }
      return json({ ok: true }, 200, origin);
    }
  }

  // DELETE /admin/workspaces/:wsId/users/:userId
  const wsUserMatch = routePath.match(/^\/admin\/workspaces\/([^/]+)\/users\/([^/]+)$/);
  if (wsUserMatch && req.method === "DELETE") {
    const [, wsId, userId] = wsUserMatch;
    if (Number(userId) === ADMIN_TELEGRAM_ID) return apiErr(400, "Cannot remove super admin", origin);
    await supabase.from("allowed_users").delete()
      .eq("telegram_id", Number(userId))
      .eq("group_id", wsId);
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": origin } });
  }

  // PATCH /admin/workspaces/:id — update name or allowed_markets
  const wsPatchMatch = routePath.match(/^\/admin\/workspaces\/([^/]+)$/);
  if (wsPatchMatch && req.method === "PATCH") {
    const wsId = wsPatchMatch[1];
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return apiErr(400, "Invalid JSON", origin); }

    const fields: Record<string, unknown> = {};
    if ("name" in body && typeof body.name === "string") fields.name = body.name;
    if ("allowed_markets" in body) {
      fields.allowed_markets = body.allowed_markets === null
        ? null
        : normalizeCountries((body.allowed_markets as string[]) ?? []);
    }
    if (!Object.keys(fields).length) return json({ ok: true }, 200, origin);

    await supabase.from("workspaces").update(fields).eq("id", wsId);
    const { data } = await supabase.from("workspaces").select("*").eq("id", wsId).single();
    return json(data, 200, origin);
  }

  return apiErr(404, "Admin route not found", origin);
}
```

- [ ] **Step 2: Wire into `swarm-api/index.ts`**

Add import near the top of `index.ts`:
```typescript
import { handleAdminRoutes } from "./admin.ts";
```

Add call just after the workspace auth gate block (after `groupId` is resolved, around line 125):
```typescript
// Admin routes (before all other route handling)
const adminResp = await handleAdminRoutes(supabase, req, routePath, telegram_id, origin);
if (adminResp) return adminResp;
```

- [ ] **Step 3: Also update `GET /me` to return `is_admin`**

In `GET /me` handler, add the `is_admin` flag to the response:
```typescript
const isAdmin = telegram_id === 744230399;
return json({ telegram_id, name, username, group_id: groupId, language: language_code, role: p?.role ?? null, markets: p?.markets ?? [], is_admin: isAdmin }, 200, origin);
```

- [ ] **Step 4: Deploy swarm-api**

```bash
supabase functions deploy swarm-api --no-verify-jwt
```

- [ ] **Step 5: Test admin endpoint**

Using the Supabase Dashboard Edge Functions logs or a curl with your `tma` token:
- `GET /admin/workspaces` should return workspace list with `user_count`
- `GET /admin/workspaces/cee/users` should return CEE workspace users
- Any other `telegram_id` → `403 Forbidden`

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/swarm-api/admin.ts supabase/functions/swarm-api/index.ts
git commit -m "feat(api): /admin/* routes — workspaces + user CRUD; GET /me adds is_admin"
```

---

## Phase 3 — Admin Mini App Screen

### Task 12: Update `types.ts` and `api.ts`

**Files:** Modify `miniapp/src/types.ts`, `miniapp/src/lib/api.ts`

- [ ] **Step 1: Add `is_admin` to `Me` type and new admin types**

In `miniapp/src/types.ts`, update `Me` and add:
```typescript
export type Me = {
  telegram_id: number;
  name: string;
  username: string | null;
  group_id: string;
  language: string | null;
  role: string | null;
  markets: string[];
  is_admin: boolean;     // ← add
};

export type AdminWorkspace = {
  id: string;
  name: string;
  allowed_markets: string[] | null;
  user_count: number;
};

export type AdminUser = {
  telegram_id: number;
  name: string;
  username: string | null;
  is_admin: boolean;
  role: string | null;
  markets: string[];
  created_at: string;
};
```

- [ ] **Step 2: Add admin API functions to `api.ts`**

```typescript
// ── Admin ─────────────────────────────────────────────────────────────────────

export async function fetchAdminWorkspaces(): Promise<AdminWorkspace[]> {
  if (DEV_MODE) return [
    { id: "cee", name: "CEE", allowed_markets: null, user_count: 3 },
    { id: "other", name: "Other Markets", allowed_markets: ["NG","MX","ID"], user_count: 2 },
  ];
  return apiFetch<AdminWorkspace[]>("/admin/workspaces");
}

export async function fetchAdminWorkspaceUsers(wsId: string): Promise<AdminUser[]> {
  if (DEV_MODE) return MOCK_USERS.map(u => ({ ...u, is_admin: false, created_at: new Date().toISOString() }));
  return apiFetch<AdminUser[]>(`/admin/workspaces/${wsId}/users`);
}

export async function addUserToWorkspace(wsId: string, telegramId: number): Promise<void> {
  if (DEV_MODE) return;
  return apiFetch<void>(`/admin/workspaces/${wsId}/users`, { method: "POST", body: JSON.stringify({ telegram_id: telegramId }) });
}

export async function removeUserFromWorkspace(wsId: string, userId: number): Promise<void> {
  if (DEV_MODE) return;
  return apiFetch<void>(`/admin/workspaces/${wsId}/users/${userId}`, { method: "DELETE" });
}

export async function patchAdminWorkspace(wsId: string, fields: { name?: string; allowed_markets?: string[] | null }): Promise<AdminWorkspace> {
  if (DEV_MODE) return { id: wsId, name: fields.name ?? wsId, allowed_markets: fields.allowed_markets ?? null, user_count: 0 };
  return apiFetch<AdminWorkspace>(`/admin/workspaces/${wsId}`, { method: "PATCH", body: JSON.stringify(fields) });
}
```

- [ ] **Step 3: Update `MOCK_ME` to have `is_admin: true`** (for dev testing)

```typescript
const MOCK_ME: Me = {
  ...,
  is_admin: true,
};
```

- [ ] **Step 4: Build check**

```bash
cd /Users/garva/swarm/miniapp && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add miniapp/src/types.ts miniapp/src/lib/api.ts
git commit -m "feat(miniapp): admin types + API functions"
```

---

### Task 13: Create `AdminScreen.tsx`

**Files:** Create `miniapp/src/components/AdminScreen.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";
import { useState, useEffect, useCallback } from "react";
import {
  fetchAdminWorkspaces, fetchAdminWorkspaceUsers,
  addUserToWorkspace, removeUserFromWorkspace, patchAdminWorkspace,
  fetchConfig,
} from "@/lib/api";
import type { AdminWorkspace, AdminUser } from "@/types";
import { countryName, COUNTRY_NAMES } from "@/lib/countries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChevronLeft, Trash2, UserPlus, Loader2 } from "lucide-react";

// ── Workspace list ────────────────────────────────────────────────────────────

function WorkspaceList({ onSelect }: { onSelect: (ws: AdminWorkspace) => void }) {
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAdminWorkspaces().then(setWorkspaces).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-center text-muted-foreground py-8 text-sm">Загрузка…</p>;

  return (
    <div className="space-y-2">
      {workspaces.map((ws) => (
        <button
          key={ws.id}
          onClick={() => onSelect(ws)}
          className="w-full text-left p-3 rounded-lg border bg-card flex items-center justify-between"
        >
          <div>
            <p className="font-medium text-sm">{ws.name}</p>
            <p className="text-xs text-muted-foreground">{ws.id}</p>
          </div>
          <Badge variant="secondary">{ws.user_count} чел.</Badge>
        </button>
      ))}
    </div>
  );
}

// ── Workspace detail — Users tab ──────────────────────────────────────────────

function WorkspaceUsers({ wsId }: { wsId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchAdminWorkspaceUsers(wsId).then(setUsers).finally(() => setLoading(false));
  }, [wsId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    const id = Number(addInput.trim());
    if (!id) return;
    setAdding(true);
    try { await addUserToWorkspace(wsId, id); setAddInput(""); load(); }
    finally { setAdding(false); }
  };

  const handleRemove = async (userId: number) => {
    if (!window.confirm("Удалить пользователя из воркспейса?")) return;
    await removeUserFromWorkspace(wsId, userId);
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Telegram ID"
          value={addInput}
          onChange={(e) => setAddInput(e.target.value)}
          className="text-sm"
          type="number"
        />
        <Button size="sm" onClick={handleAdd} disabled={adding || !addInput.trim()}>
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.telegram_id} className="flex items-center gap-2 p-2.5 rounded-lg border bg-card">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{u.name}</p>
                <p className="text-xs text-muted-foreground">
                  {u.username ? `@${u.username} · ` : ""}{u.telegram_id}
                </p>
                {u.role && <p className="text-xs text-muted-foreground">{u.role}</p>}
              </div>
              {u.markets.length > 0 && (
                <span className="text-xs text-muted-foreground">{u.markets.map(countryName).join(", ")}</span>
              )}
              <button onClick={() => handleRemove(u.telegram_id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Workspace detail — Markets tab ────────────────────────────────────────────

function WorkspaceMarkets({ ws, onUpdated }: { ws: AdminWorkspace; onUpdated: () => void }) {
  const allCodes = Object.keys(COUNTRY_NAMES);
  // null = use global list (all codes)
  const [selected, setSelected] = useState<string[] | null>(ws.allowed_markets);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isCustom = selected !== null;

  const toggle = (code: string) => {
    if (!isCustom) return;
    setSelected(prev =>
      (prev ?? allCodes).includes(code)
        ? (prev ?? allCodes).filter(c => c !== code)
        : [...(prev ?? allCodes), code]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await patchAdminWorkspace(ws.id, { allowed_markets: selected });
      setSaved(true);
      onUpdated();
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Режим:</p>
        <div className="flex gap-2">
          <button
            onClick={() => setSelected(null)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${!isCustom ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground"}`}
          >
            Глобальный список
          </button>
          <button
            onClick={() => setSelected(ws.allowed_markets ?? allCodes)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${isCustom ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground"}`}
          >
            Свой список
          </button>
        </div>
      </div>

      {isCustom && (
        <div className="flex flex-wrap gap-1.5">
          {allCodes.map((code) => (
            <button
              key={code}
              onClick={() => toggle(code)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                selected!.includes(code)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground border-border"
              }`}
            >
              {countryName(code)}
            </button>
          ))}
        </div>
      )}

      {!isCustom && (
        <p className="text-xs text-muted-foreground">Пользователи видят все рынки из глобального списка.</p>
      )}

      <Button size="sm" onClick={handleSave} disabled={saving} className="w-full">
        {saving ? "Сохраняю…" : saved ? "✓ Сохранено" : "Сохранить"}
      </Button>
    </div>
  );
}

// ── Workspace detail screen ───────────────────────────────────────────────────

function WorkspaceDetail({ ws, onBack }: { ws: AdminWorkspace; onBack: () => void }) {
  const [workspace, setWorkspace] = useState(ws);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-5 pb-3 flex items-center gap-2">
        <button onClick={onBack} className="text-muted-foreground">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-semibold">{workspace.name}</h1>
        <span className="text-xs text-muted-foreground ml-auto">{workspace.id}</span>
      </div>

      <Tabs defaultValue="users" className="flex-1 flex flex-col">
        <TabsList className="mx-4 grid grid-cols-2">
          <TabsTrigger value="users">Пользователи</TabsTrigger>
          <TabsTrigger value="markets">Рынки</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="flex-1 overflow-y-auto px-4 py-3 mt-0">
          <WorkspaceUsers wsId={workspace.id} />
        </TabsContent>
        <TabsContent value="markets" className="flex-1 overflow-y-auto px-4 py-3 mt-0">
          <WorkspaceMarkets ws={workspace} onUpdated={() => setWorkspace(w => ({ ...w, allowed_markets: workspace.allowed_markets }))} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function AdminScreen() {
  const [selected, setSelected] = useState<AdminWorkspace | null>(null);

  if (selected) {
    return <WorkspaceDetail ws={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">Суперадмин</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Воркспейсы и рынки</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <WorkspaceList onSelect={setSelected} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
cd /Users/garva/swarm/miniapp && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add miniapp/src/components/AdminScreen.tsx
git commit -m "feat(miniapp): AdminScreen — workspace users + markets config"
```

---

### Task 14: Wire admin tab into navigation

**Files:** Modify `miniapp/src/components/BottomNav.tsx`, `miniapp/src/app/page.tsx`

- [ ] **Step 1: Read `BottomNav.tsx` to find the `Section` type and `TABS` array**

The Section type is defined at the top of the file. Add `"admin"` to the union.

- [ ] **Step 2: Update `BottomNav.tsx`**

```typescript
// Section type — add "admin"
type Section = "tasks" | "knowledge" | "meetings" | "team" | "settings" | "admin";

// TABS array — add admin entry (only show when isAdmin prop is true)
// Change the component signature to accept isAdmin:
export function BottomNav({ active, onChange, isAdmin }: {
  active: Section;
  onChange: (s: Section) => void;
  isAdmin: boolean;
}) {
  const TABS = [
    { id: "tasks" as const, label: "Задачи", Icon: ClipboardList },
    { id: "knowledge" as const, label: "База", Icon: BookOpen },
    { id: "meetings" as const, label: "Встречи", Icon: CalendarDays },
    { id: "team" as const, label: "Команда", Icon: Users },
    { id: "settings" as const, label: "Ещё", Icon: Settings },
    ...(isAdmin ? [{ id: "admin" as const, label: "Админ", Icon: ShieldCheck }] : []),
  ];
  // rest of the component unchanged
```

Add `ShieldCheck` to Lucide imports.

- [ ] **Step 3: Update `page.tsx`**

```tsx
// Add import
import { AdminScreen } from "@/components/AdminScreen";

// Pass isAdmin prop to BottomNav:
<BottomNav active={section} onChange={setSection} isAdmin={me?.is_admin ?? false} />

// Add AdminScreen to render block:
{section === "admin" && <AdminScreen />}
```

- [ ] **Step 4: Build check**

```bash
cd /Users/garva/swarm/miniapp && npm run build 2>&1 | tail -20
```

Expected: build succeeds, no TypeScript errors.

- [ ] **Step 5: Commit + push**

```bash
git add miniapp/src/components/BottomNav.tsx miniapp/src/app/page.tsx
git commit -m "feat(miniapp): conditional admin tab in BottomNav"
git push origin sandbox_vas
```

---

### Task 15: Deploy miniapp (Cloudflare Pages)

- [ ] **Step 1: Verify Cloudflare auto-deploy from `sandbox_vas`**

Check the Cloudflare Pages dashboard or wait for the deploy to complete after the push in Task 14.

- [ ] **Step 2: Open mini app as `@FeelFire` (telegram_id 744230399)**

Verify:
- "Админ" tab appears in bottom nav
- Tapping shows workspace list with user counts
- Tapping "CEE" workspace → shows Users tab with all team members
- Users have correct names (no "null")
- Markets tab shows chip picker for `workspaces.allowed_markets`
- Setting custom markets + saving → reopen settings, markets picker reflects new list

- [ ] **Step 3: Open mini app as another team member**

Verify "Админ" tab does NOT appear.

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -p && git commit -m "fix(miniapp): <description of any fixes>"
git push origin sandbox_vas
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ ISO code normalization for `entries.countries` — Tasks 1, 4, 5, 6, 7, 8
- ✅ ISO code normalization for `user_profiles.markets` — Tasks 1, 4, 7
- ✅ Existing data migrated — Task 4
- ✅ `workspaces.allowed_markets` column — Task 3
- ✅ `GET /config` exposes per-workspace markets — Task 9
- ✅ Chip picker in SettingsScreen uses ISO codes + loads from API — Task 10
- ✅ Admin gate in swarm-api — Task 11
- ✅ Workspace CRUD (view, user add/remove) — Task 11
- ✅ Per-workspace markets management — Task 11
- ✅ `is_admin` flag in `GET /me` — Task 11
- ✅ Admin types + api.ts functions — Task 12
- ✅ AdminScreen UI — Task 13
- ✅ Conditional nav tab — Task 14

**Known gaps / follow-up:**
- `is_admin` in `GET /me` is hardcoded (`telegram_id === 744230399`), not from `allowed_users.is_admin` column. This is intentional — `allowed_users.is_admin` is unused and not set anywhere. Fixing it properly requires a superadmin command to grant/revoke admin — out of scope here.
- Workspace creation/deletion not in admin panel (still only via Telegram bot `/superadmin` command). Out of scope.
- Read.ai webhook `group_id` is hardcoded to `"cee"` (line 255 of `read-ai-webhook/index.ts`) — separate tech debt, not changed here.
