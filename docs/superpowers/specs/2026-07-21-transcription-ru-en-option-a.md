# Транскрибация RU→EN — Option A (план реализации)

> Источник: ultracode research workflow 2026-07-21. Одобрено владельцем (Option A целиком).
> Контекст: встреча b8b7a609 была ОФЛАЙН (sys/собеседник-дорожки нет by design) → фикс чисто в edge-функции, рекордер не трогаем.

## ПРОПОЗАЛ

I have the code grounded. Confirmed line references: `transcribeAudio` 94–127 (model `whisper-1` line 97, `language` append line 104), `isWhisperHallucination` 16–22 (regex line 9–10, prob gate line 20), `langCode` 144–151, `anchorSysLang` 156–165, summarize-time anchor recompute line 317, mismatch guard line 324, `transcript.language` line 333, transcribe loop `micHint` line 438 / `hint` line 444. Writing the proposal.

---

# Proposal: keep Russian meetings Russian even when the sys track is silent

Scope: transcription robustness only. The recorder-side capture gap (собеседник track missing) is the separate Swift track — this proposal assumes it can and will happen and makes the pipeline survive it.

## 1. Root-cause recap (meeting b8b7a609)

- The mic track's language pin is derived **only** from the sys (собеседник) track via `anchorSysLang()` → `langCode()` (`meeting-processor.ts:438`). When the sys track never produced a usable `p.lang` (silent/absent capture), the anchor is `undefined`, so `micHint` is `undefined` and `language` is never appended (`:104`). Whisper then free-auto-detects 785 Russian mic segments and lands on English.
- Two independent ways to reach `undefined`: (a) `anchorSysLang()` returns nothing because no sys part reached `done` with a `lang`; (b) even a detected anchor name outside the ~15-entry `langCode` allow-list (`:144–151`) collapses to `undefined`. The observed final `transcript.language === "english"` means path (a): the anchor was falsy at summarize time too (`:317`).
- The silence hallucination (the Welsh "Diolch yn fawr am wylio" family) slips every existing gate: the blacklist regex (`whisper-hallucinations.ts:9–10`) is RU/EN-only, and the `noSpeechProb>0.8 && avgLogprob<-0.5` AND-gate (`:20`) is a documented soft spot for *confident* silence hallucinations (low `no_speech_prob`, high `avg_logprob`).
- **Key correction from external research:** the repo comment at `:99–100` ("`language="ru"` → переводил всё на русский") is a misdiagnosis. On OpenAI's hosted API, `language` is only a detection *hint* and can **never** translate foreign speech into Russian — translation-to-English lives only on the separate `/translations` endpoint. So pinning a language for the mic track is safe and was over-restricted out of fear of a bug that cannot occur.

## 2. Options

### Option A — Robust language-pin fallback + hallucination-aware anchor (smallest change, whisper-1 stays)
Four edits, all in the two existing files, no new dependency, no model/cost change:

1. **Per-meeting default language as last-resort mic pin.** Add a `default_lang` column to `meetings` (ADD COLUMN — safe per project rules), populated at ingest from the recorder owner's Telegram `language_code` (already on the auth payload, `swarm-api/auth.ts:3,70,80`; currently never plumbed to the meeting path). In the transcribe loop change `:438` so `micHint` falls back to `langCode(m.default_lang)` when `anchorSysLang()` yields nothing; mirror the same fallback for the summarize-time anchor at `:317`. This directly fixes b8b7a609: a Russian owner's silent-sys meeting pins the mic to `ru`.
2. **Hallucination-aware anchor.** In `anchorSysLang()` (`:156–165`) only count a sys part's `p.lang` toward the vote if it produced real segments (exclude parts whose only content came from the `d.text` fallback at `:122–125`, and require a small minimum segment count/duration). Stops a hallucinated sys part from poisoning the pin.
3. **Widen `langCode` to the full ISO-639-1 table** (`:144–151`) so a legitimately-detected anchor is never silently dropped just because it's unmapped.
4. **Multilingual + repeated-segment hallucination filter** (see §4).

- Effort: ~0.5–1 day incl. tests + one migration.
- Risk: low. The only behavioural edge is a Russian owner who *speaks English on their own mic in a silent-sys meeting* — the `ru` fallback pin would bias that mic to Russian. This is far rarer than the silent-sys case, `language` is a soft hint (not enforced), and a truly silent mic has no real speech to corrupt. Acceptable.
- Fixes b8b7a609: yes, directly — the mic pin no longer collapses to `undefined`.

### Option B — Swap mic transcription to `gpt-4o-transcribe` + Russian `prompt` + `language`
Change `transcribeAudio` (`:97`) to `gpt-4o-transcribe`, always pass `language` (from anchor-or-default per Option A), and add a Russian `prompt` ("Это стенограмма встречи на русском языке.") to bias register.

- Effort: ~1–2 days. Non-trivial: `gpt-4o-transcribe` returns `json`/`text` only — **no `verbose_json`, no per-segment timestamps, no `no_speech_prob`**. Our whole segment/offset/mismatch-guard machinery (`:119–127`, `:447`, `:324`) depends on segment timestamps, so this is not a drop-in — it needs a parallel code path or keeping whisper-1 for structure.
- Risk: medium-high. Loses the `no_speech_prob`/`avg_logprob` gate entirely; one independent report shows `gpt-4o-transcribe` regressing vs whisper-1 on long-form audio (43.8% vs 9.7% WER); Azure lists these snapshots retiring ~2026-06-01 (verify availability first). Also carries its own silent-chunk-echoes-the-prompt hallucination bug.
- Fixes b8b7a609: only if combined with Option A's pin. On its own it *reduces* silence hallucination frequency but does not guarantee the language stays Russian.

### Option C — VAD / silence gate before Whisper (most structural)
Add a Silero-VAD-style energy/speech gate in `uploadPartsAndBuildState`/the transcribe loop: don't send a part (or trim long silence to a short pad) when it contains no speech. This is the single most load-bearing fix cited across the external research — kill the hallucination at the source rather than filtering after.

- Effort: high, ~3–5 days. No VAD exists anywhere in the pipeline today; Deno edge functions have no native audio DSP — needs new WASM/audio-analysis code, and Silero v5 is only ~61% accurate on pure noise, so it's not a complete guarantee either.
- Risk: high (new code path, largest surface, edge-runtime constraints).
- Fixes b8b7a609: yes, and prevents the *whole family* — but disproportionate lift for a go/no-go this cycle.

## 3. Recommendation

**Do Option A now.** It is the smallest change, touches only the two files already owned by this problem plus one safe `ADD COLUMN`, and directly closes the b8b7a609 failure mode: the mic pin never silently collapses to `undefined`, the anchor can't be poisoned by a hallucinated sys part, and any legitimately-detected language survives the `langCode` map. The external research's most important finding is that the fear behind removing the global `ru` pin was unfounded — pinning cannot translate — which removes the only objection to a default-language fallback.

Explicitly **defer B and C.** Option B is a real WER/robustness lever but is a structural change (loses `verbose_json`/segments and the confidence gate) that deserves its own empirical A/B on our own meeting corpus (including deliberately silent stretches) before adopting — the public Russian-specific WER data is too thin to swap on trust. Option C is the correct long-term structural fix and should become a backlog item, but the lift is disproportionate for this cycle and Option A already stops the observed harm.

Pairing note: when Option A's anchor becomes reliable, re-examine the mismatch guard at `:324` — today it *discards* an entire mic part whose lang ≠ anchor. With a trustworthy anchor + default pin that path becomes more likely to fire, and silently dropping the owner's real transcript is worse than the disease. Prefer re-transcribing that part *with the anchor pin* over discarding it.

## 4. Exact hallucination-filter addition (Welsh / non-EN "thanks for watching")

Two complementary changes in `whisper-hallucinations.ts`. The regex is defence-in-depth; the **repeated-segment detector is the real fix** because it is language-agnostic and catches any translated outro variant without maintaining a blacklist per language.

**(a) Broaden the blacklist regex (`:9–10`)** with the documented multilingual outro family:

```ts
export const WHISPER_HALLUCINATION_RE =
  /субтитр|продолжение следует|спасибо за просмотр|подписывайтесь|подпиш[иеё]тесь|подпишись на канал|до новых встреч|dimatorzok|amara\.org|thank you for watching|thanks for watching|please subscribe|diolch yn fawr|gracias por ver|obrigado por assistir|grazie per (aver )?guard|merci d'avoir regardé|danke f[üu]rs? zuschauen|untertitel|subtitles by|subscribe to (my|the) channel|시청해 주셔서|ご視聴ありがとう|感谢观看|谢谢观看/i;
```

(`diolch yn fawr` is the Welsh case; the rest are the ES/PT/IT/FR/DE/KO/JA/ZH variants catalogued in arxiv 2501.11378 and OpenWhispr #462.)

**(b) Add a language-agnostic repeated-line detector.** The silence outro repeats verbatim across a part's segments — that pattern is unmistakable regardless of language. Add to `whisper-hallucinations.ts` and call it in `transcribeAudio` after building `segments` (`meeting-processor.ts:121`):

```ts
// Тихая дорожка часто выдаёт ОДНУ фразу-«аутро», повторённую дословно по всем сегментам
// (в любом языке — валлийское "Diolch yn fawr", "谢谢观看" и т.д.). Реальная речь так не выглядит.
// Язык-независимо: если ≥MIN_REPEATS сегментов — одна и та же нормализованная строка и она
// доминирует в части, считаем всю часть галлюцинацией тишины.
const REPEAT_MIN = 3;
const REPEAT_DOMINANCE = 0.6;
export function isRepeatedFiller(texts: string[]): boolean {
  const norm = texts.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (norm.length < REPEAT_MIN) return false;
  const counts = new Map<string, number>();
  for (const t of norm) counts.set(t, (counts.get(t) ?? 0) + 1);
  const top = Math.max(...counts.values());
  return top >= REPEAT_MIN && top / norm.length >= REPEAT_DOMINANCE;
}
```

Then in `transcribeAudio`, if `isRepeatedFiller(segs.map(s => s.text))`, drop the part's segments (return empty) so it contributes no text and no `p.lang`. This also fixes the `d.text` fallback path (`:123`) leaking the same phrase, and — combined with Option A #2 — prevents a repeated-outro sys part from ever becoming the anchor.

## 5. How to verify

**Blocker before finalizing:** the code analysis flagged one unconfirmed fact — whether b8b7a609's sys parts died as poisoned failures vs. hallucinated-but-`done`. Note that `cleanupStorage` (`:382`) deletes the audio on `done`, so b8b7a609 itself is **not re-runnable end-to-end**; the reconstruction (anchor falsy → path (a)) can only be confirmed from the persisted `meetings.process_state`/`transcript` row. Query that row first to confirm the diagnosis, but don't block the fix on it — Option A closes both paths (a) and (b) regardless.

**Unit tests (the load-bearing logic — no audio needed):**
- `langCode`: known name → ISO code; unmapped-but-valid name → now mapped (regression against the old silent-drop); junk → `undefined`.
- `anchorSysLang`: hallucination-only sys part (segments all from `d.text` fallback / below min count) does **not** win the anchor vote; a real sys part does.
- `micHint` fallback: no sys anchor + `default_lang="ru"` → pin resolves to `ru` (this is the b8b7a609 assertion); no anchor + no default → `undefined` (unchanged behaviour, foreign meetings untouched).
- `isWhisperHallucination` / `isRepeatedFiller`: Welsh "Diolch yn fawr am wylio'r fideo!" caught by both the widened regex and the repeat detector; a genuine Russian transcript with an incidentally repeated short phrase (e.g. "да, да, да") does **not** trip the dominance threshold.

**Integration smoke (real flow, per project rule #2):** record a new short RU meeting on the recorder with a **deliberately silent sys track** (собеседник muted / not captured), run it through `meeting-process`, and assert `transcript.language === "ru"` and no English outro text in the mic segments. Then a second recording with a genuinely English sys track to confirm foreign meetings still auto-detect correctly (no false `ru` forcing when a real anchor exists). Check `get_logs` on the edge function, not just "deploy succeeded".

**Pre-push gate:** `deno check` the two changed files (pre-commit hook enforces it) and update `docs/ARCHITECTURE.md` (transcription flow + the new `meetings.default_lang` column) in the same commit per the docs-currency rule.

---

## CODE ANALYSIS (точные line refs)

## Call chain: mic-track language hint → why it fell through to "no pin"

**Where the hint is computed** — `meeting-processor.ts:429-456`, inside `runMeetingStep`'s `stage === "transcribe"` loop:

```
436  const pendingSys = pendingAll.filter((p) => p.track === "sys");
437  const pending = pendingSys.length > 0 ? pendingSys : pendingAll;
438  const micHint = pendingSys.length > 0 ? undefined : langCode(anchorSysLang(state.parts));
...
444  const hint = p.track === "mic" ? micHint : undefined;
445  const { segments: segs, language } = await transcribeAudio(blob, p.name, hint);
```

The design intent (per the comments at `meeting-processor.ts:99-103, 433-435`): fully drain all `sys` parts first (no hint, Whisper auto-detects), then compute `anchorSysLang()` over the now-done sys parts, convert it to an ISO code via `langCode()`, and use that as the mic pin. Two separate places can independently produce `undefined` and both were live in this incident:

1. **`anchorSysLang()` itself** (`meeting-processor.ts:156-165`) only counts sys parts where `p.done && p.lang` are both truthy, weighted by segment count, and returns `undefined` if nothing qualifies. It has **no concept of hallucination or reliability** — it will happily anchor on whatever language Whisper *claims* to have detected, hallucinated or not (see next point).

2. **`langCode()`** (`meeting-processor.ts:144-151`) is a hard-coded 14-entry allow-list (`ru/en/uk/be/kk/uz/de/fr/es/it/pt/pl/tr/ar/zh`). Welsh is not in it. So even in the branch where `anchorSysLang()` *does* return a language string (e.g. whatever name Whisper's `d.language` reports for a Welsh-looking hallucinated phrase — plausibly `"welsh"`), `langCode("welsh")` returns `undefined` at line 150-151, and `micHint` collapses to `undefined` regardless.

Either path — sys anchor genuinely empty (no sys part ever reached `done` with a usable `lang`), or sys anchor present but unmapped (`"welsh"` not in `LANG_NAME_TO_CODE`) — yields the identical observable symptom: `micHint === undefined`, so line 104 (`if (languageHint) form.append("language", languageHint)`) never appends a `language` param, and Whisper free-runs auto-detection on 785 mic segments of Russian speech, landing on English.

One data point worth flagging precisely: the final `transcript.language` field is set at `meeting-processor.ts:333` as `anchor ?? dominantLang(state.parts)`, where `anchor` is *recomputed* at summarize time (`meeting-processor.ts:317`, same `anchorSysLang()` function, same rules). Since the observed final value was `"english"`, `anchor` must have evaluated **falsy** at summarize time too (if it had resolved to a truthy but unmapped value like `"welsh"`, that value — not `"english"` — would have been written as `transcript.language`, and the mic-vs-anchor mismatch guard at line 324 would additionally have dropped the whole mic track as an "off-language" hallucination). So the internally-consistent reconstruction is: **no sys part ever reached `done` with a `p.lang` set** (i.e., every sys part exhausted `MAX_PART_ATTEMPTS` at `meeting-processor.ts:29,431,457` without ever successfully returning a `d.language`, or all its content was excluded before `p.lang` assignment) — meaning `anchorSysLang()` returned `undefined` both times it was called, not a stray language name. This can't be fully pinned down from static reading alone; it would need a look at `process_state.parts` (or `transcript`) for meeting `b8b7a609` to confirm whether the sys parts landed as poisoned failures vs. hallucinated-but-`done`. I did not query the DB in this read-only pass — flagging as the one fact worth verifying before finalizing the design.

## (b) Would the Welsh hallucination be caught by whisper-hallucinations.ts?

**No.** `WHISPER_HALLUCINATION_RE` at `whisper-hallucinations.ts:9-10` is:

```
/субтитр|продолжение следует|спасибо за просмотр|подписывайтесь|подпиш[иеё]тесь|подпишись на канал|
до новых встреч|dimatorzok|amara\.org|thank you for watching|thanks for watching|please subscribe/i
```

This is exclusively Russian phrasing plus **English-only** "thank(s) for watching" variants. There is no Welsh (`"Diolch yn fawr am wylio'r fideo!"`), and no generic multilingual pattern. The regex layer cannot catch it under any circumstance.

The only other gate is the probabilistic heuristic at `whisper-hallucinations.ts:20`: `noSpeechProb > 0.8 && avgLogprob < -0.5`. Whether this catches the Welsh phrase is not guaranteed — the well-documented Whisper silence-hallucination bug (this "thanks for watching"/outro family, e.g. openai/whisper#679, faster-whisper#530) typically produces these lines with the model "confidently" hallucinating text (often *low* `no_speech_prob`, since the encoder isn't classifying the frame as silence, and `avg_logprob` not reliably below `-0.5`), so this AND-gated heuristic frequently misses this exact hallucination family — it's a known soft spot, not a hard guarantee either way. Bottom line: **there is no language-agnostic coverage** in this file at all; the blacklist is EN/RU-specific by construction, and even the fallback path at `meeting-processor.ts:122-125` (which re-adds raw `d.text` when segments were filtered to zero) re-checks against the *same* EN/RU-only regex, so a Welsh (or any other non-EN/RU) hallucination that slips the probability gate will always resurface via the fallback too.

## (c) Every place a fix could go

| # | Location | Fix |
|---|---|---|
| 1 | `langCode()` map, `meeting-processor.ts:144-151` | Widen the allow-list (full ISO-639-1 table) so a legitimately-detected anchor language is never silently dropped to `undefined` just because it's unmapped — narrowest, lowest-risk fix, but doesn't address a *hallucinated* anchor. |
| 2 | `anchorSysLang()`, `meeting-processor.ts:156-165` | Make the anchor hallucination-aware: only count a sys part's `p.lang` toward the vote if the part actually produced real (non-hallucination-filtered) segments — i.e. exclude parts whose only content came from the `d.text` fallback at line 122-125, or require a minimum segment count / minimum total duration before trusting `p.lang`. This directly targets "reject hallucination-derived anchor languages" from the prompt. |
| 3 | `transcribeAudio()`, `meeting-processor.ts:94-127` | Return per-call reliability signals (e.g. `no_speech_prob`/`avg_logprob` stats, or "all segments were hallucination-filtered") alongside `language`, so callers (site #2) can make an informed trust decision instead of trusting bare `d.language`. |
| 4 | Mic-hint fallback, `meeting-processor.ts:438,444` | When `anchorSysLang()`/`langCode()` yields no usable pin, don't leave `micHint` as bare `undefined` — fall back to a **per-meeting/per-user default language** (see (d) — none currently exists, would need to be added) before giving up entirely and letting Whisper free-auto-detect. This is "per-track fallback default language" from the prompt. |
| 5 | `whisper-hallucinations.ts:9-10` regex | Broaden the blacklist to cover known multilingual variants of this exact hallucination family (Welsh "Diolch yn fawr am wylio'r fideo", and other known translations of "thanks for watching"/outro hallucinations catalogued in the upstream Whisper issues) — directly closes the gap in (b), independent of the anchor logic. |
| 6 | `isWhisperHallucination()`, `whisper-hallucinations.ts:16-21` | Tighten/tune the probabilistic thresholds (`noSpeechProb > 0.8 && avgLogprob < -0.5`) specifically for the "confident hallucination on silence" pattern — e.g. add a repeated-identical-segment detector (this phrase repeats verbatim across a part), which is language-agnostic and would have caught the Welsh case without needing a translated blacklist entry. |
| 7 | Model/config swap point | `transcribeAudio()`'s `form.append("model", "whisper-1")` at `meeting-processor.ts:97` — swapping to a newer model (e.g. `gpt-4o-transcribe`/`gpt-4o-mini-transcribe`) is a legitimate lever since those models are reported to hallucinate on silence far less than `whisper-1`; would need its own research/verification pass (cost, verbose_json/segment support, no_speech_prob availability) before adopting. |
| 8 | Silence/VAD gate | No VAD or silence-detection exists anywhere in this pipeline today — `uploadPartsAndBuildState()` (`meeting-processor.ts:252-272`) and the transcribe loop send every recorded part to Whisper unconditionally. A pre-transcription silence check (e.g. energy/RMS threshold on the sys blob before calling Whisper) would prevent the hallucination at the source rather than filtering it after the fact — this is the most structural fix but the largest lift (new audio-analysis code path). |
| 9 | Mic-vs-anchor mismatch guard, `meeting-processor.ts:324` | Currently drops an entire mic part outright if its `p.lang` differs from `anchor` — this is a blunt instrument that (per the reconstruction above) would have deleted the whole real transcript had `anchor` resolved non-empty. Any fix to #2 should be paired with re-examining whether this guard should instead *re-transcribe with a pin* rather than silently discard content. |

## (d) Existing config/env carrying a default meeting/user language

**None exists today.** Searched the full meeting pipeline (`meeting-ingest`, `meeting-process`, `meeting-claim`, `meeting-heartbeat`, `meeting-status`, `meeting-webtoken`, `meeting-processor.ts`) plus `meetings` table schema (`supabase/migrations/20260612000000_meetings.sql`) — no column, env var, or request param carries a default/preferred spoken-language for a meeting or its recorder.

The only adjacent artifact is `language_code` on the Telegram auth payload (`supabase/functions/swarm-api/auth.ts:3,70,80` and `swarm-api/index.ts:265,271,319`) — this is the **Telegram client UI locale** (e.g. `"en"`/`"ru"` from `verified.language_code`), used only for API response localization, and is **never read by `meeting-processor.ts` or `meeting-ingest`**. It's a plausible source to plumb through as fix #4's fallback default (the meeting owner's Telegram client is very likely set to their spoken language), but it currently has zero connection to the transcription path and would need new wiring: `meetings` row would need to carry it (e.g. a new `default_lang` column populated at ingest time from the recorder's `language_code`), then `runMeetingStep`/`summarizeAndFinish` would need to read it as the last-resort pin.

## Files read in full
- `/Users/garva/Documents/projects/Swarm-brain/supabase/functions/_shared/meeting-processor.ts`
- `/Users/garva/Documents/projects/Swarm-brain/supabase/functions/_shared/whisper-hallucinations.ts`
- `/Users/garva/Documents/projects/Swarm-brain/supabase/migrations/20260612000000_meetings.sql` (schema check for (d))
- `/Users/garva/Documents/projects/Swarm-brain/supabase/functions/swarm-api/auth.ts`, `index.ts` (language_code check for (d))

---

## EXTERNAL RESEARCH

# OpenAI Audio Transcription for Russian: Reliability Research (as of July 2026)

## 1. Model lineup on `/v1/audio/transcriptions` right now

| Model | Status/notes | `response_format` | `language` param | `prompt` param | streaming | logprobs/no_speech_prob |
|---|---|---|---|---|---|---|
| **whisper-1** | Legacy, open-source Whisper (large-v2) hosted by OpenAI. Also the **only** model that supports `/v1/audio/translations`. | `json`, `text`, `srt`, `verbose_json`, `vtt` | yes (hint) | yes (last 224 tokens only, prompt ignored beyond that) | **not supported** | `verbose_json` exposes per-segment `no_speech_prob`/`avg_logprob` (classic Whisper fields) |
| **gpt-4o-transcribe** | GA, marketed as lower-WER, more noise/accent-robust than Whisper. | `json` or `text` only (no `verbose_json`, no segment timestamps) | yes (hint) | yes, more flexible than whisper-1's 224-token window | **supported** (SSE `transcript.text.delta`/`.done`) | no `no_speech_prob`; only token-level `logprobs` via `include=["logprobs"]` |
| **gpt-4o-mini-transcribe** | Cheaper/faster sibling of the above, same param surface. | same as gpt-4o-transcribe | yes | yes | yes | same as gpt-4o-transcribe |
| **gpt-4o-transcribe-diarize** | Adds speaker diarization (`known_speaker_names`/`known_speaker_references`, up to 4 speakers). | `json`, `text`, `diarized_json` | yes | **not supported** | not covered in guide | requires `chunking_strategy` (auto or VAD config) for audio >30s |

Sources: [Speech to text guide](https://developers.openai.com/api/docs/guides/speech-to-text), [Create transcription API reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create), [GPT-4o Transcribe model page](https://developers.openai.com/api/docs/models/gpt-4o-transcribe)

**Version-specific flag:** Azure's OpenAI model-lifecycle page lists `gpt-4o-transcribe`/`gpt-4o-mini-transcribe` (2025-03-20 snapshots) and whisper-1 as retiring around **2026-06-01**, i.e. potentially already past on Azure by the time you read this (today is 2026-07-21). This is an Azure-hosted-model retirement, not necessarily OpenAI's own platform, but confirm current model availability before building on a specific snapshot — [source](https://community.openai.com/t/gpt-4o-transcribe-and-audio-model-ready-to-use-via-api/1219993).

**Russian-specific WER:** I could not find a published per-language WER table isolating Russian for gpt-4o-transcribe vs whisper-1 — OpenAI's own audio-models announcement blog (which reports FLEURS-style multilingual benchmarks) returned a 403 to fetch, and the community/vendor summaries I could reach only state aggregate/general claims ("gpt-4o-transcribe shows lower WER... especially on accented speech, technical vocabulary, noisy audio," but with at least one reported regression case where gpt-4o-transcribe did *worse* than whisper-1 on long-form audio: 43.8% vs 9.7% WER on financial earnings calls). **Treat any Russian-specific WER claim as unverified from my searches — recommend an empirical A/B on your own meeting corpus rather than trusting a vendor claim.** Sources: [OpenAI blog (blocked, 403)](https://openai.com/index/introducing-our-next-generation-audio-models/), [WER by language discussion](https://novascribe.ai/how-accurate-is-whisper), [Subtitle Engineering comparison](https://medium.com/@unicornporated/subtitle-engineering-showdown-of-speech-to-text-giants-and-building-the-ultimate-subtitle-24ea2c21c6bf).

## 2. Does `language="ru"` ever force translation *into* Russian?

**No — this is architecturally impossible on OpenAI's hosted API, and the claim in your repo is almost certainly a misdiagnosis.** Whisper's decoder only ever has two output modes:
- **transcribe** — output text in the source language (the `language` param here is only a *hint that pins/biases language identification*, not a translation trigger).
- **translate** — output text that is **always English**, never any other target language. This task lives only on `/v1/audio/translations`, and on OpenAI's hosted API **only `whisper-1` exposes that endpoint at all** — `gpt-4o-transcribe` models have no translations endpoint.

So there is no code path in OpenAI's API where setting `language=ru` causes *other-language speech to be translated into Russian*. What's much more likely behind that repo comment:
- Confusion with a **local** Whisper CLI/wrapper (whisper.cpp, faster-whisper) where `--task` and `--language` are separate flags a caller can mis-combine — those tools do have a distinct `--task translate` mode, but even there it only ever translates *to English*, never to the `--language` value ([whisper.cpp discussion](https://github.com/ggml-org/whisper.cpp/issues/695), [faster-whisper issue #48](https://github.com/guillaumekln/faster-whisper/issues/48)).
- Or the audio genuinely contained Russian throughout and was correctly transcribed as Russian, which got misread as "translated."

Sources: [Speech to text guide — transcriptions vs translations](https://developers.openai.com/api/docs/guides/speech-to-text), [Whisper-1 joint translation/transcription thread](https://community.openai.com/t/whisper-1-joint-translation-and-transcription/580359), [openai/whisper Discussion #649 — "doesn't translate in non-english anymore"](https://github.com/openai/whisper/discussions/649).

## 3. What actually causes the "flips to English" bug, and how practitioners fix it

`language="ru"` is described in the docs only as improving "accuracy and latency" — it is **not strictly enforced**. A dedicated community thread on exactly this ("GPT-4o-transcribe language enforcement") reports the model still mixing languages even with `language` set, especially on ambiguous audio; one OpenAI Developer Community member disputed this as implementation-specific rather than universal, so treat it as a real but inconsistent risk, not a guaranteed failure — [source](https://community.openai.com/t/gpt-4o-transcribe-language-enforcement/1357014). Related reports specifically call out that **short vocalizations and silence trigger wrong-language detection** (a Microsoft Q&A thread documents `gpt-4o-transcribe` mixing up Chinese/Malay/Tamil/English on exactly this trigger) — [source](https://learn.microsoft.com/en-au/answers/questions/5583062/issue-with-gpt-4o-transcribe-detecting-wrong-langu).

**Recommended stack, in priority order (this is what practitioners actually converge on):**

1. **VAD-gate the audio before it ever reaches the API.** This is the single most load-bearing fix cited across every source I found: strip/trim silence and non-speech segments with a VAD (Silero VAD is the go-to) *before* calling transcription, rather than relying on the model to behave on silence. One nuance from WhisperX-style practice: don't zero out all silence — trim long gaps (>~1.5s) down to a short fixed pad (~0.3–0.5s) rather than to nothing, since a fixed short pause preserves natural punctuation cues without giving the decoder room to hallucinate. Caveat: Silero VAD v5 is only ~61% accurate at the utterance level on pure-noise (ESC-50) data, so pure noise can still slip through as "speech" — [source](https://github.com/OpenWhispr/openwhispr/issues/462), [Pre-processing discussion](https://github.com/openai/whisper/discussions/2378).
2. **Always pass `language="ru"` anyway.** Even though not perfectly enforced, it's free, reduces LID errors, and improves latency per the docs — no reason to omit it.
3. **Use `prompt` in Russian, not English**, to reinforce both language and register — OpenAI's own guidance says the prompt "should match the audio language," and community testing shows explicit natural-language instructions in the prompt (e.g., "Это стенограмма встречи на русском языке.") measurably help bias the decoder.
4. **Prefer `gpt-4o-transcribe` over `whisper-1` for this use case** given OpenAI's general claim of better language recognition — but validate empirically per point above, since at least one independent report shows regressions vs whisper-1 on long-form audio.
5. **Watch out for a `gpt-4o-transcribe`-specific hallucination bug**: on near-silent/very short audio chunks *combined with a `prompt`*, the model has been reported to echo glossary/prompt content verbatim even though nothing was said — worse if you're on the Realtime API with server-side VAD, since you don't control which segments actually reach the model. Mitigation: **skip sending the prompt (or skip the API call entirely) for chunks your own VAD already flagged as non-speech**, rather than trusting the model to self-suppress — [source](https://community.openai.com/t/gpt-4o-transcribe-outputs-content-from-prompt-instruction-for-small-silent-audio-samples/1367326).
6. **Segment on VAD boundaries, not fixed time windows**, when chunking long meetings — splitting speech mid-word at arbitrary boundaries is itself a hallucination trigger.

## 4. Known silence-hallucination patterns and filtering

This is a well-documented, cross-language phenomenon rooted in Whisper's YouTube-subtitle training data bleeding into low-signal audio:
- **"Careless Whisper: Speech-to-Text Hallucination Harms"** (Koenecke et al., FAccT 2024) found hallucinations in ~1% of transcriptions on audio containing non-speech, with 38% of those hallucinations containing explicit harms (fabricated violence, false authority claims, etc.), and disproportionately affecting speakers with longer non-vocal gaps (e.g., aphasia) — a directly relevant finding for meeting audio with real silence. It also documents Whisper generating **non-English text even when a target language argument is set** — [arxiv 2402.08021](https://arxiv.org/abs/2402.08021), [ACM version](https://dl.acm.org/doi/10.1145/3630106.3658996).
- **The boilerplate "family"** recurs across languages, not just English: "thank you for watching"/"thanks for watching" (documented at 24.76%/10.32% of non-speech hallucination instances in one study), French "Sous-titres réalisés par la communauté d'Amara.org", German "Copyright WDR 2021 Untertitel im Auftrag des ZDF" — [arxiv 2501.11378](https://arxiv.org/pdf/2501.11378), [OpenWhispr issue #462](https://github.com/OpenWhispr/openwhispr/issues/462). I could **not independently verify** the specific Welsh example mentioned in your question from my searches — flag it as unconfirmed/anecdotal rather than something I can cite.
- **The classic `no_speech_prob`/`avg_logprob` dual-threshold filter** (used in openai/whisper and faster-whisper) is documented as **insufficient on its own**: hallucinated segments can carry high `avg_logprob` confidence while `no_speech_prob` stays low, letting them slip past the filter — [source](https://arxiv.org/html/2501.11378v1), [faster-whisper issue #621](https://github.com/SYSTRAN/faster-whisper/issues/621). Note also this heuristic is **whisper-1-only** on the hosted API — `gpt-4o-transcribe` doesn't expose `no_speech_prob` at all, only token-level `logprobs` via `include=["logprobs"]`, so this recipe doesn't port 1:1 if you switch models.
- **What actually works better than the logprob heuristic**: VAD-based cut/merge (WhisperX-style — use external VAD segment boundaries instead of the model's own decoded silence/timestamp tokens) reduces both hallucination and repetition rates; plus a **static blacklist** of the known boilerplate phrases above as a defense-in-depth post-filter, applied regardless of source model.

## Bottom line for your use case

- `language="ru"` is safe to always set and never causes translation-to-Russian of foreign speech — that specific repo claim doesn't match how the API works and is likely a local-tool `--task`/`--language` mixup, not the hosted API.
- The real risk is **silence/short-vocalization-triggered mislabeling and hallucination**, not an intentional translation feature — the fix is VAD gating before the API call (primary), `language` pinning + Russian-language `prompt` (secondary, cheap), and a static hallucination-phrase blacklist as a last-line filter, since the built-in confidence heuristics are known to be leaky and, on `gpt-4o-transcribe`, mostly unavailable anyway.
- Everything Russian-specific (WER numbers, exact enforcement rate of `language=ru`) is thin in public sources as of this research — worth a small internal benchmark on your actual meeting recordings (including deliberately silent stretches) before committing to a model choice.
