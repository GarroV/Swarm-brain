#!/usr/bin/env python3
"""Execute the actual replay engine with synthetic psql/Deno; no database or network."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def run_case(kind):
    with tempfile.TemporaryDirectory(prefix="swarm-replay-fixture-") as directory:
        root = Path(directory)
        for folder in ["scripts/porcha-sql-replay.d", "supabase/migrations", "bin"]:
            (root / folder).mkdir(parents=True)
        for script in ["porcha-sql", "porcha-sql-replay-list.sh"]:
            shutil.copy2(ROOT / "scripts" / script, root / "scripts" / script)
        (root / "scripts/porcha-sql.txt").write_text("OLD|BROKEN|fixture.test.ts|supabase/migrations/20261001000000_base.sql\n")
        for name, content in [("20260918120000_initiatives_board.sql", "INITIAL"),
                              ("20261001000000_base.sql", "OLD"),
                              ("20261001010000_forward_a.sql", "A"),
                              ("20261001020000_forward_b.sql", "B")]:
            (root / "supabase/migrations" / name).write_text(content + "\n")
        declaration = root / "scripts/porcha-sql-replay.d/test.txt"
        declaration.write_text("supabase/migrations/20261001020000_forward_b.sql\nsupabase/migrations/20261001010000_forward_a.sql\n")
        if kind == "missing":
            declaration.write_text("supabase/migrations/20261001030000_missing.sql\n")
        if kind == "invalid":
            declaration.write_text("../../other.sql\n")
        if kind == "empty":
            declaration.write_text("")
        psql = root / "bin/psql"
        psql.write_text('''#!/usr/bin/env python3
import os,sys,pathlib
args=sys.argv[1:]
if '-f' not in args: sys.exit(0)
body=pathlib.Path(args[args.index('-f')+1]).read_text().strip()
trace=pathlib.Path(os.environ['REPLAY_TRACE']); old=trace.read_text() if trace.exists() else ''
trace.write_text(old+body+'\\n')
if os.environ['REPLAY_CASE']=='replay_failure' and body=='B': sys.exit(1)
if os.environ['REPLAY_CASE']=='restore_failure' and body=='A' and 'OLD\\n' in old: sys.exit(1)
''')
        psql.chmod(0o755)
        deno = root / "bin/deno"
        deno.write_text("#!/bin/sh\nexit 1\n")  # the mutation test is correctly RED
        deno.chmod(0o755)
        trace = root / "trace"
        env = dict(os.environ, PATH=str(root / "bin") + os.pathsep + os.environ["PATH"],
                   REPLAY_CASE=kind, REPLAY_TRACE=str(trace))
        result = subprocess.run(["bash", "scripts/porcha-sql"], cwd=root, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        expected = 0 if kind == "order" else 1
        assert result.returncode == expected, (kind, result.returncode, result.stdout)
        entries = trace.read_text().splitlines() if trace.exists() else []
        if kind == "order":
            assert entries == ["BROKEN", "A", "B", "OLD", "A", "B"], entries
        if kind in ["missing", "invalid", "empty"]:
            assert not entries, entries
        print("PASS", kind)


if __name__ == "__main__":
    for case in ["order", "missing", "invalid", "empty", "replay_failure", "restore_failure"]:
        run_case(case)
