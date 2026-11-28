#!/usr/bin/env python3
"""Prepare the shared push configuration on the VPS; default is read-only check.

Apply requires the normal approved deployment window. This command neither reloads
functions nor restarts scriba. No credential is printed or passed in process argv.
"""
import argparse
import json
import os
import re
import secrets
import stat
import subprocess
import sys
import uuid
from pathlib import Path

API_URL = "http://supabase-envoy:8000/functions/v1"
SIGNAL_URL = "http://scriba-signals:8091/signal"
CALENDAR_PUSH_URL = "https://api.swarm-team.app/functions/v1/calendar-push"
NETWORK = "swarm_default"
SECRET_PATTERN = re.compile(r"[0-9a-f]{64}\Z")


class PushConfigurationError(ValueError):
    """Fixed, non-sensitive reason safe for operator output."""


def validate_secret(value):
    if not SECRET_PATTERN.fullmatch(value):
        raise ValueError("shared secret must be 32 random bytes encoded as lowercase hex")
    return value


def read_private(path):
    if path.is_symlink():
        raise ValueError("configuration symlinks are not supported")
    metadata = path.stat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
        raise ValueError("configuration must be a regular owner-only file")
    return path.read_text()


def with_values(source, values):
    lines = source.splitlines(keepends=True)
    found = set()
    result = []
    for line in lines:
        name = line.partition("=")[0]
        if name not in values:
            result.append(line)
            continue
        if name in found:
            raise ValueError("duplicate push configuration key")
        found.add(name)
        result.append(name + "=" + values[name] + "\n")
    if result and not result[-1].endswith("\n"):
        result[-1] += "\n"
    result.extend(name + "=" + value + "\n" for name, value in values.items() if name not in found)
    return "".join(result)


def atomic_private(path, content):
    temporary = path.with_name(path.name + ".push-" + uuid.uuid4().hex)
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def command(args, data=None):
    result = subprocess.run(args, input=data, capture_output=True, text=True)
    if result.returncode:
        # psql/Compose errors can echo input. Emit a fixed error, retain no stdout/stderr.
        raise RuntimeError("push configuration prerequisite or database update failed")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--secret-stdin", action="store_true")
    parser.add_argument("--state", type=Path, default=Path("/srv/scriba/state"))
    parser.add_argument("--functions-env", type=Path, default=Path("/srv/swarm/supabase/functions.env"))
    parser.add_argument("--db-container", default="supabase-db")
    parser.add_argument("--calendar-push-url", default=CALENDAR_PUSH_URL)
    args = parser.parse_args()
    if args.secret_stdin and not args.apply:
        parser.error("--secret-stdin requires --apply")
    if args.calendar_push_url != CALENDAR_PUSH_URL:
        raise PushConfigurationError("calendar_push_url_not_canonical")
    state = args.state.resolve(strict=True)
    if state.stat().st_mode & 0o077:
        raise ValueError("state directory must be owner-only")
    secret_path = state / "signal.secret"
    prod_path = state / "prod.env"
    functions_path = args.functions_env
    functions_source = read_private(functions_path)
    functions = dict(line.split("=", 1) for line in functions_source.splitlines() if "=" in line)
    existing_push_url = functions.get("GOOGLE_CALENDAR_PUSH_URL")
    if existing_push_url and existing_push_url != args.calendar_push_url:
        raise PushConfigurationError("calendar_push_url_conflict")
    prod_source = read_private(prod_path) if prod_path.exists() else None
    stored = validate_secret(read_private(secret_path).strip()) if secret_path.exists() else None
    if not args.apply:
        ready = stored is not None and functions.get("SCRIBA_SIGNAL_SECRET") == stored
        ready = ready and functions.get("SCRIBA_SIGNAL_URL") == SIGNAL_URL
        ready = ready and functions.get("GOOGLE_CALENDAR_PUSH_URL") == args.calendar_push_url
        print(json.dumps({"configured_files": ready, "read_only": True,
                          "vault_and_runtime_checked": False}))
        return 0 if ready else 1
    command(["docker", "network", "inspect", NETWORK])
    psql = ["docker", "exec", "-i", args.db_container, "psql", "-U", "postgres", "-d", "postgres",
            "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"]
    existing = json.loads(command(psql, "SELECT coalesce(json_object_agg(name, decrypted_secret), '{}'::json) "
                                 "FROM vault.decrypted_secrets WHERE name = 'scriba_signal_secret';\n").strip())
    vault_secret = validate_secret(existing["scriba_signal_secret"]) if existing.get("scriba_signal_secret") else None
    secret = validate_secret(sys.stdin.read().strip()) if args.secret_stdin else stored or vault_secret or secrets.token_hex(32)
    if any(value is not None and value != secret for value in [stored, vault_secret]):
        raise ValueError("existing shared secret differs; rotation requires a separate coordinated procedure")
    functions_candidate = with_values(functions_source, {
        "SCRIBA_SIGNAL_SECRET": secret, "SCRIBA_SIGNAL_URL": SIGNAL_URL,
        "GOOGLE_CALENDAR_PUSH_URL": args.calendar_push_url,
    })
    prod_candidate = with_values(prod_source, {
        "SCRIBA_SIGNAL_SECRET": secret, "SCRIBA_SWARM_URL": API_URL, "SCRIBA_API_NETWORK": NETWORK,
    }) if prod_source is not None else None
    # SQL values are restricted to hex and fixed internal URLs. Neither goes in argv.
    sql = "BEGIN;\n"
    for name, value in [("scriba_signal_secret", secret), ("scriba_functions_url", API_URL)]:
        sql += "DO $push$ DECLARE existing uuid; BEGIN "
        sql += f"SELECT id INTO existing FROM vault.secrets WHERE name = '{name}'; "
        sql += f"IF existing IS NULL THEN PERFORM vault.create_secret('{value}', '{name}'); "
        sql += f"ELSE PERFORM vault.update_secret(existing, '{value}'); END IF; END $push$;\n"
    sql += "COMMIT;\n"
    command(psql, sql)
    # Keep private pre-change copies; applying these files alone does not affect running services.
    suffix = ".before-push-" + uuid.uuid4().hex
    atomic_private(functions_path.with_name(functions_path.name + suffix), functions_source)
    atomic_private(functions_path, functions_candidate)
    if prod_candidate is not None:
        atomic_private(prod_path.with_name(prod_path.name + suffix), prod_source)
        atomic_private(prod_path, prod_candidate)
    atomic_private(secret_path, secret + "\n")
    print(json.dumps({"configured_files": True, "vault_configured": True, "runtime_reloaded": False,
                      "shared_secret_rotated": False, "private_backups_retained": True}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except PushConfigurationError as error:
        print(json.dumps({"configured": False, "error": str(error), "runtime_reloaded": False}))
        sys.exit(2)
    except (OSError, ValueError, RuntimeError):
        print(json.dumps({"configured": False, "error": "push_configuration_failed", "runtime_reloaded": False}))
        sys.exit(2)
