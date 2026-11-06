#!/usr/bin/env python3
"""Remove SQL comments while preserving quoted/dollar-quoted SQL for the guard."""
import re
import sys

DOLLAR = re.compile(r"\$(?:[^\W\d]\w*)?\$")


def strip_comments(sql):
    out = []
    i = 0
    while i < len(sql):
        if sql.startswith("--", i):
            end = sql.find("\n", i)
            end = len(sql) if end < 0 else end
            out.append(" " * (end - i))
            i = end
        elif sql.startswith("/*", i):
            depth = 1
            out.append("  ")
            i += 2
            while i < len(sql) and depth:
                if sql.startswith("/*", i):
                    depth += 1
                    out.append("  ")
                    i += 2
                elif sql.startswith("*/", i):
                    depth -= 1
                    out.append("  ")
                    i += 2
                else:
                    out.append("\n" if sql[i] == "\n" else " ")
                    i += 1
            if depth:
                raise ValueError("unterminated SQL block comment")
        elif sql[i] in "'\"":
            quote = sql[i]
            start = i
            escaped = quote == "'" and i > 0 and sql[i - 1] in "eE" and (i < 2 or not (sql[i - 2].isalnum() or sql[i - 2] == "_"))
            i += 1
            while i < len(sql):
                if escaped and sql[i] == "\\":
                    i += 2
                elif sql[i] == quote:
                    i += 1
                    if i < len(sql) and sql[i] == quote:
                        i += 1
                    else:
                        break
                else:
                    i += 1
            else:
                raise ValueError("unterminated SQL quote")
            out.append(sql[start:i])
        elif sql[i] == "$" and (match := DOLLAR.match(sql, i)):
            # Function bodies/dynamic SQL can touch protected tables: keep them whole.
            tag = match.group()
            end = sql.find(tag, match.end())
            if end < 0:
                raise ValueError("unterminated SQL dollar quote")
            end += len(tag)
            out.append(sql[i:end])
            i = end
        else:
            out.append(sql[i])
            i += 1
    return "".join(out)


if __name__ == "__main__":
    try:
        sys.stdout.write(strip_comments(sys.stdin.read()))
    except ValueError as error:
        print(f"Cannot inspect migration: {error}", file=sys.stderr)
        sys.exit(2)
