#!/usr/bin/env python3
"""Check or prepare the seven owner-approved Compose memory limits (#916).

This deliberately accepts a small block-mapping shape, not arbitrary YAML.
Only memory scalar values or missing memory lines can change. No Docker/SSH calls.
"""
import json
import os
from pathlib import Path
import re
import sys


MAX_BYTES = 1024 * 1024
MAX_LINES = 10000
MAX_LINE_BYTES = 16384
POLICY = {
    "db": ("2g", 2 * 1024**3),
    "functions": ("2g", 2 * 1024**3),
    "storage": ("512m", 512 * 1024**2),
    "imgproxy": ("512m", 512 * 1024**2),
    "auth": ("256m", 256 * 1024**2),
    "rest": ("256m", 256 * 1024**2),
    "api-gw": ("256m", 256 * 1024**2),
}
MEMORY_FIELDS = ("mem_limit", "memswap_limit")
SERVICE = re.compile(rb"  ([A-Za-z0-9][A-Za-z0-9_.-]*): *(?:#[^\r\n]*)?$")
FIELD = re.compile(rb"    ([A-Za-z_][A-Za-z0-9_-]*):(?: |$)")
ROOT_SERVICES = re.compile(rb"services: *(?:#[^\r\n]*)?$")
MEMORY = re.compile(rb"([0-9]+)([bBkKmMgG]?)$")


class ConfigError(Exception):
    """Fixed error kind only: never include file contents or exception details."""


def body(line):
    return line.removesuffix(b"\n").removesuffix(b"\r")


def memory_bytes(value):
    if value[:1] in (b"'", b'"'):
        if len(value) < 2 or value[-1:] != value[:1]:
            raise ConfigError("unsupported_memory_value")
        value = value[1:-1]
    if value == b"-1":
        return -1
    match = MEMORY.fullmatch(value)
    if not match:
        raise ConfigError("unsupported_memory_value")
    number, unit = match.groups()
    if len(number) > 20:
        raise ConfigError("unsupported_memory_value")
    return int(number) * 1024 ** {b"": 0, b"b": 0, b"k": 1, b"m": 2, b"g": 3}[unit.lower()]


def scalar_parts(line):
    """Split an already identified memory field without changing its comment/spacing."""
    content = body(line)
    colon = content.index(b":")
    tail = content[colon + 1:]
    value_part, marker, comment = tail.partition(b"#")
    value = value_part.strip(b" ")
    if not value:
        raise ConfigError("unsupported_memory_value")
    left = len(value_part) - len(value_part.lstrip(b" "))
    right = len(value_part) - len(value_part.rstrip(b" "))
    prefix = content[:colon + 1] + value_part[:left]
    suffix = (value_part[-right:] if right else b"") + marker + comment
    ending = line[len(content):]
    quote = value[:1] if value[:1] in (b"'", b'"') else b""
    return memory_bytes(value), prefix, quote, suffix, ending


def analyze(data):
    if len(data) > MAX_BYTES:
        raise ConfigError("input_too_large")
    if b"\t" in data:
        raise ConfigError("tabs_not_supported")
    if b"\r" in data.replace(b"\r\n", b""):
        raise ConfigError("invalid_line_endings")
    if b"\r\n" in data and data.count(b"\n") != data.count(b"\r\n"):
        raise ConfigError("invalid_line_endings")
    try:
        data.decode("utf-8")
    except UnicodeError:
        raise ConfigError("invalid_encoding") from None
    if any(c < 32 and c not in (10, 13) for c in data):
        raise ConfigError("invalid_encoding")
    lines = data.splitlines(keepends=True)
    if len(lines) > MAX_LINES or any(len(line) > MAX_LINE_BYTES for line in lines):
        raise ConfigError("input_too_large")
    starts = []
    for i, line in enumerate(lines):
        content = body(line)
        if content.startswith(b"services:"):
            if not ROOT_SERVICES.fullmatch(content):
                raise ConfigError("ambiguous_structure")
            starts.append(i)
    if len(starts) != 1:
        raise ConfigError("missing_services_block" if not starts else "duplicate_services_block")
    start = starts[0]
    end = len(lines)
    for i in range(start + 1, len(lines)):
        content = body(lines[i])
        if content and not content.startswith((b" ", b"#")):
            end = i
            break
    headers, fields = {}, {}
    current = None
    for i in range(start + 1, end):
        content = body(lines[i])
        if not content.strip() or content.lstrip(b" ").startswith(b"#"):
            continue
        indent = len(content) - len(content.lstrip(b" "))
        if indent == 2:
            match = SERVICE.fullmatch(content)
            if not match:
                raise ConfigError("ambiguous_structure")
            current = match[1].decode("ascii")
            if current in headers:
                raise ConfigError("duplicate_service")
            headers[current], fields[current] = i, {}
        elif indent < 4 or current is None:
            raise ConfigError("ambiguous_structure")
        elif indent == 4:
            match = FIELD.match(content)
            if not match:
                raise ConfigError("ambiguous_structure")
            key = match[1].decode("ascii")
            if key in fields[current]:
                raise ConfigError("duplicate_field")
            fields[current][key] = i
    if any(service not in headers for service in POLICY):
        raise ConfigError("missing_service")
    changes, replacements, insertions = [], {}, {}
    newline = b"\r\n" if b"\r\n" in data else b"\n"
    for service, (value, expected) in POLICY.items():
        header = headers[service]
        for key in MEMORY_FIELDS:
            if key not in fields[service]:
                if not lines[header].endswith(b"\n"):
                    raise ConfigError("ambiguous_structure")
                insertions.setdefault(header, []).append(f"    {key}: {value}".encode() + newline)
            else:
                at = fields[service][key]
                actual, prefix, quote, suffix, ending = scalar_parts(lines[at])
                if actual == expected:
                    continue
                replacements[at] = prefix + quote + value.encode() + quote + suffix + ending
            changes.append({"service": service, "field": key, "expected_bytes": expected})
    candidate = b"".join(
        replacements.get(i, line) + b"".join(insertions.get(i, []))
        for i, line in enumerate(lines)
    )
    return candidate, changes


def write_candidate(path, candidate):
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise ConfigError("candidate_exists") from None
    except OSError:
        raise ConfigError("io_write") from None
    owned = os.fstat(fd)
    stream_owns_fd = False
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as output:
            stream_owns_fd = True
            if output.write(candidate) != len(candidate):
                raise OSError("short write")
            output.flush()
            os.fsync(output.fileno())
    except OSError:
        if not stream_owns_fd:
            os.close(fd)
        try:
            present = os.lstat(path)
            if (present.st_dev, present.st_ino) == (owned.st_dev, owned.st_ino):
                os.unlink(path)
        except OSError:
            pass
        raise ConfigError("io_write") from None


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        if len(argv) == 1:
            mode, source, target = "check", argv[0], None
        elif len(argv) == 2 and argv[0] == "check":
            mode, source, target = "check", argv[1], None
        elif len(argv) == 3 and argv[0] == "prepare":
            mode, source, target = "prepare", argv[1], argv[2]
        else:
            raise ConfigError("invalid_arguments")
        try:
            with Path(source).open("rb") as input_file:
                data = input_file.read(MAX_BYTES + 1)
        except OSError:
            raise ConfigError("io_read") from None
        candidate, changes = analyze(data)
        if mode == "prepare":
            write_candidate(target, candidate)
        status = "prepared" if mode == "prepare" else "needs_changes" if changes else "ok"
        print(json.dumps({"status": status, "changes": changes, "error_type": None}))
        return int(mode == "check" and bool(changes))
    except ConfigError as error:
        print(json.dumps({"status": "error", "changes": [], "error_type": str(error)}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
