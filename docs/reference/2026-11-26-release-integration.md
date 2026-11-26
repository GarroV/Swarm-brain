# Recorder and cockpit integration, 26 November 2026

The integration branch combines prepared PRs #1349, #1351, #1352 and #1350 on
main `5d991735196d750b85d8e112e71a95d37496163d`. Each original head is retained
as a merge ancestor; no cherry-picks or history rewriting were used.

| PR | Preserved head | Prepared behavior |
|---|---|---|
| #1349 | `451af8adb76ba66f68e5ea27ee86660f2fa60243` | Stop polling unavailable meetings while retaining audio until TTL; scriba smoke updates |
| #1351 | `c8e179cba663e006ec5d94c818816c52d7662918` | Inline recording notices, notes collapse behavior and VERSION 42 preparation |
| #1352 | `f4c83068fdb4759e807a64a5b26314dce583fd9b` | Unknown CoreAudio state, native RU/EN menu strings and bumblebee.app archive root |
| #1350 | `73511f55e1afe6d7c92893b467f0f62301bc547e` | Actual daily metric chart and compact Decimus quality summary |

Only `docs/ARCHITECTURE.md` conflicted. Its resolution preserves both the inline
notices behavior and the native localization/CoreAudio descriptions. AppDelegate,
main.swift and the cockpit TypeScript merged automatically. No new product
behavior was introduced by the integration.

## Targeted integration checks

- `cd recorder && swift build -c debug`: exit 0; build complete in 9.55 seconds.
- `.build/debug/SwarmRecorder --selftest-status-poll`: PASS; actual client and durable
  queue cover 503 retry, old-server compatibility, explicit unavailable response,
  restart persistence, audio retention and TTL.
- `.build/debug/SwarmRecorder --selftest-inline-notices-check`: PASS, 17 checks;
  actual AppKit components without showing windows.
- `.build/debug/SwarmRecorder --selftest-call-detector`: PASS, 11 cases;
  hardware, audio and network unused.
- `git diff --check`: clean. All four original head commits are merge ancestors.

The SwiftPM executable emits the expected missing BeeMark.png warning outside
an application bundle. This run does not verify release bundle artwork. The
compiler also reports actor-isolation/Sendable warnings in the prepared sources;
they did not prevent the debug build. No universal release archive, signing,
publication, manifest promotion, production deployment or freeze was performed.

The UI merged without conflicts, so the existing successful PR #1350 build,
types and remote layout evidence are reused. Previously recorded individual
branch checks are not repeated as a full suite or a new audit. Published UI and
release artifact verification remain deployment steps.
