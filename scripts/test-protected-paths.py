#!/usr/bin/env python3
"""Exercise the real guard in disposable Git repositories (#914)."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
MUTATE = sys.argv[1:] == ["porcha"]


def git(root, *args):
    subprocess.run(["git", "-c", "user.name=Guard Fixture", "-c", "user.email=fixture@example.invalid", *args],
                   cwd=root, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def check(name, sql, expected, *, protected=False, approved=False):
    with tempfile.TemporaryDirectory(prefix="swarm-protected-") as folder:
        root = Path(folder)
        (root / "scripts").mkdir()
        (root / ".github").mkdir()
        (root / "supabase/migrations").mkdir(parents=True)
        for script in ("check-protected-paths.sh", "strip-sql-comments.py"):
            if (ROOT / "scripts" / script).exists():
                shutil.copy2(ROOT / "scripts" / script, root / "scripts" / script)
        if MUTATE:
            guard = root / "scripts/check-protected-paths.sh"
            text = guard.read_text()
            lines = text.splitlines(keepends=True)
            hits = [i for i, line in enumerate(lines) if "if grep -qiE" in line and '"$SQL"' in line]
            assert len(hits) == 1, "mutation did not find the SQL guard"
            lines[hits[0]] = "      if false; then\n"
            guard.write_text("".join(lines))
        (root / ".github/protected-paths.txt").write_text("protected.ts\n")
        git(root, "init", "-q")
        git(root, "add", ".")
        git(root, "commit", "-qm", "fixture baseline")
        base = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
        (root / "supabase/migrations/fixture.sql").write_text(sql)
        if protected:
            (root / "protected.ts").write_text("export {};\n")
        git(root, "add", ".")
        message = "fixture change" + ("\n\nOwner-approved: fixture-only consent" if approved else "")
        git(root, "commit", "-qm", message)
        result = subprocess.run(["bash", "scripts/check-protected-paths.sh", base], cwd=root,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        assert result.returncode == expected, f"{name}: expected {expected}, got {result.returncode}\n{result.stdout}"
        print("PASS", name)


if __name__ == "__main__":
    if MUTATE:
        try:
            check("projects still protected", "alter table public.projects add column fixture int;\n", 1)
        except AssertionError as error:
            assert "expected 1, got 0" in str(error), str(error)
            print("PASS mutation caught: skipping the SQL guard makes the regression fail")
            sys.exit(0)
        raise AssertionError("mutation survived: the regression did not catch the skipped SQL guard")
    check("line comment only", "-- projects and public.sprints are unchanged\nselect 1;\n", 0)
    check("block and nested comments", "/* projects /* sprints */ projects */\nselect 1;\n", 0)
    check("inline comment", "select 1; -- projects\nselect 2; /* sprints */\n", 0)
    check("invalid comment fails closed", "select 1; /* unfinished projects", 2)
    check("projects still protected", "alter table public.projects add column fixture int;\n", 1)
    check("sprints still protected", "insert into sprints (name) values ('fixture');\n", 1)
    check("comments around real operation", "/* sprints */ alter table /* note */ projects add column fixture int;\n", 1)
    check("quoted marker does not hide SQL", "select '--', '/*'; alter table projects add column fixture int;\n", 1)
    check("escaped quote does not hide SQL", "select E'it\\'s --'; alter table projects add column fixture int;\n", 1)
    check("dollar string does not hide SQL", "select $tag$--$tag$; alter table sprints add column fixture int;\n", 1)
    check("SQL inside dollar string stays protected", "do $$ begin execute 'alter table projects add column fixture int'; end $$;\n", 1)
    check("registry still protected", "select 1;\n", 1, protected=True)
    check("consent still accepted", "alter table projects add column fixture int;\n", 0, approved=True)
