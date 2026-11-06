# One-off recorded duration repair (#121)

`recorded-duration-repair.sql` defines **session-local** helpers only. It performs no repair
on load and creates no permanent function/migration. Application workflows do not call it.
Production use requires a separately reviewed private measured plan and explicit rollout approval.

Measure the actual retained AAC/M4A files with the current deployed
`meeting-ingest/audio-length.ts`: union of `[offset, offset + measured duration]` intervals,
not summed tracks, transcript timestamps or calendar duration. Every referenced part must be
readable and measured. Keep meeting identifiers, audio paths and any access material out of git,
PRs and logs; private snapshots/plans use mode600. Never include failed meetings or recordings
with unknown duration.

Each of exactly four plan items has `meeting_id`, `row_hash`, `audio_hash`, `measured_seconds`.
`row_hash` is `md5((to_jsonb(m) - 'recorded_seconds')::text)` from the measured snapshot (UTC session);
`audio_hash` uses the same definition as `pg_temp.recorded_duration_audio_hash(process_state)`.
It includes ordered object ids, versions, metadata and update times. A planner must compare the
fetched byte size with the object metadata and verify unchanged fingerprints after measurement.
No plan with production identifiers belongs in this directory.

The operator loads the helpers and calls `pg_temp.repair_recorded_durations(private_plan)` in
one short explicit transaction. It locks all four meeting rows and referenced audio metadata,
requires NULL seconds, desktop-agent/done, matching holder, no bot/challenger/rival and exact row
and audio fingerprints. **Any stale item rejects the entire batch**; PostgreSQL rolls back all
four. It updates only `recorded_seconds`, then verifies that every other column is unchanged.
No reprocessing, model call or notification sender is invoked.

Enabled triggers that could run on this column (including statement-level triggers) block the
repair; none are disabled. The ordinary selective people-sync trigger does not fire when only
seconds are in the SET list. Foreign-key involvement of the seconds column also blocks repair.
The real isolated-Postgres regression tests check full row preservation, ownership/source/status/
audio/object-version changes, repeated apply and a synthetic side-effect trigger. A subprocess
runs a deliberately broken SQL copy without snapshot CAS and must fail (RED); the guarded path
must pass (GREEN). Local stands/Docker are not needed: execute these DB tests only in isolated CI.
