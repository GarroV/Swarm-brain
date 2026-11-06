#!/usr/bin/env python3
"""Reject new monoliths and growth of existing ones, from Git snapshots (#265)."""
import argparse
import json
import subprocess
import sys
from pathlib import PurePosixPath

LIMIT = 800
REGISTRY = "scripts/source-size-debt.json"
EXTENSIONS = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".sh", ".bash",
    ".swift", ".sql", ".ps1", ".psm1", ".css", ".scss", ".html", ".yml", ".yaml", ".mk",
}
BLOBS = {}


def git(*args):
    return subprocess.check_output(["git", *args], stderr=subprocess.PIPE)


def snapshot(ref):
    """Use the index in hooks: unstaged edits cannot hide the staged violation."""
    if ref == ":":
        entries = git("ls-files", "--stage", "-z").split(b"\0")
        result = {}
        for entry in filter(None, entries):
            meta, path = entry.split(b"\t", 1)
            mode, oid, stage = meta.split()
            if stage != b"0":
                raise ValueError("unmerged index")
            if mode in (b"100644", b"100755"):
                result[path.decode()] = oid.decode()
        return result
    entries = git("ls-tree", "-rz", ref).split(b"\0")
    result = {}
    for entry in filter(None, entries):
        meta, path = entry.split(b"\t", 1)
        mode, kind, oid = meta.split()
        if kind == b"blob" and mode in (b"100644", b"100755"):
            result[path.decode()] = oid.decode()
    return result


def source_path(path):
    p = PurePosixPath(path)
    name = p.name.lower()
    return p.suffix.lower() in EXTENSIONS or name in {"makefile", "gnumakefile", "dockerfile", "containerfile"} or name.startswith(("dockerfile.", "containerfile."))


def source_lines(files):
    result = {}
    wanted = {
        oid for path, oid in files.items()
        if (not PurePosixPath(path).suffix or source_path(path))
        and oid not in BLOBS
    }
    if wanted:
        output = subprocess.check_output(
            ["git", "cat-file", "--batch"], input="".join(f"{oid}\n" for oid in sorted(wanted)).encode()
        )
        offset = 0
        for oid in sorted(wanted):
            end = output.index(b"\n", offset)
            name, kind, size = output[offset:end].split()
            if name.decode() != oid or kind != b"blob":
                raise ValueError("unexpected git blob response")
            offset = end + 1
            BLOBS[oid] = output[offset:offset + int(size)]
            offset += int(size) + 1
    # Read only source files and extensionless scripts; never interpret symlinks.
    for path, oid in files.items():
        suffix = PurePosixPath(path).suffix
        if suffix and not source_path(path):
            continue
        data = BLOBS[oid]
        if source_path(path) or data.startswith(b"#!"):
            data = data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
            result[path] = data.count(b"\n") + int(bool(data) and not data.endswith(b"\n"))
    return result


def registry(files):
    if REGISTRY not in files:
        return {}
    value = json.loads(git("cat-file", "blob", files[REGISTRY]))
    if not isinstance(value, dict) or any(
        not isinstance(k, str) or type(v) is not int or v <= LIMIT
        for k, v in value.items()
    ):
        raise ValueError("invalid source-size debt registry")
    return value


def violations(before, after, old_debt, debt):
    errors = []
    for path, count in after.items():
        if count <= LIMIT:
            continue
        previous = before.get(path, 0)
        if previous <= LIMIT:
            errors.append(f"{path}: new monolith ({count} > {LIMIT})")
        elif count > min(previous, old_debt.get(path, previous)):
            errors.append(f"{path}: monolith grew ({previous} -> {count})")
        if debt.get(path) != count:
            errors.append(f"{path}: registry must record exactly {count} lines")
    for path in debt:
        if after.get(path, 0) <= LIMIT:
            errors.append(f"{path}: remove resolved or missing debt from registry")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged", action="store_true")
    parser.add_argument("--base", default="origin/main")
    args = parser.parse_args()
    if args.staged:
        try:
            git("rev-parse", "--verify", "HEAD")
        except subprocess.CalledProcessError:
            before_files = {}
        else:
            before_files = snapshot("HEAD")
        after_files = snapshot(":")
    else:
        base = git("merge-base", "HEAD", args.base).decode().strip()
        before_files = snapshot(base)
        after_files = snapshot("HEAD")
    before = source_lines(before_files)
    after = source_lines(after_files)
    errors = violations(before, after, registry(before_files), registry(after_files))
    for error in errors:
        print(f"source-size: {error}", file=sys.stderr)
    if errors:
        return 1
    print(f"source-size: PASS ({len(after)} source files; {sum(n > LIMIT for n in after.values())} existing monoliths)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"source-size: cannot verify snapshots: {error}", file=sys.stderr)
        sys.exit(2)
