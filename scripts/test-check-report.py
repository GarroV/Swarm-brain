#!/usr/bin/env python3
"""Run scripts/check in an isolated fixture; diagnostics must remain valid JSON/JUnit (#1105)."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent.parent
DIAGNOSTIC = 'мёртвый код, границы: "quoted" C:\\temp\\file.ts ' + ''.join(
    chr(n) for n in range(1, 32) if n != 10
)


def executable(path, text):
    path.write_text(text)
    path.chmod(0o755)


def check_report(status):
    with tempfile.TemporaryDirectory(prefix="swarm-check-report-") as directory:
        fixture = Path(directory)
        for name in ("scripts", "bin", "miniapp/node_modules", "supabase/functions/example"):
            (fixture / name).mkdir(parents=True)
        shutil.copy2(ROOT / "scripts/check", fixture / "scripts/check")
        (fixture / "scripts/feature-paths.txt").write_text("supabase/functions/example/index.ts\n")
        (fixture / "scripts/coverage-floor.txt").write_text("0\n")
        (fixture / "supabase/functions/example/index.ts").write_text("export {};\n")
        executable(fixture / "scripts/gate-coverage.sh", "#!/bin/sh\necho coverage\n")
        executable(fixture / "bin/npx", "#!/bin/sh\nexit 0\n")
        executable(fixture / "bin/deno", '''#!/bin/sh
case "$1" in
  test)
    mkdir -p reports/cov
    junit=''
    for arg in "$@"; do
      case "$arg" in --junit-path=*) junit="${arg#--junit-path=}" ;; esac
    done
    if [ -n "$junit" ]; then
      printf '<testsuite tests="1" skipped="0"></testsuite>\\n' > "$junit"
    else
      printf '<testsuite tests="1" skipped="0"></testsuite>\\n'
    fi
    # Deno prints a coverage summary to stdout after its JUnit report.
    printf '| File | Branch %% | Function %% | Line %% |\\n'
    exit 0 ;;
  coverage) exit 0 ;;
esac
printf '%s\\n' "$CHECK_DIAGNOSTIC"
exit "$CHECK_STATUS"
''')
        env = dict(os.environ, SWARM_DB_ENV="1", CHECK_STATUS=str(status),
                   CHECK_DIAGNOSTIC=DIAGNOSTIC, PATH=str(fixture / "bin") + os.pathsep + os.environ["PATH"])
        result = subprocess.run(["bash", str(fixture / "scripts/check"), "initiatives"],
                                env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        assert result.returncode == status, result.stdout
        report = json.loads((fixture / "reports/check.json").read_text())
        assert report["failed"] == status, report
        roles = {row["role"]: row for row in report["roles"]}
        assert len(roles) == 8, report
        for role in ("формат", "линт", "мёртвый-код", "границы", "типы-функции"):
            assert roles[role]["status"] == ("pass" if status == 0 else "fail"), roles[role]
            assert roles[role]["detail"] == DIAGNOSTIC + " ", repr(roles[role]["detail"])
        # Full diagnostics are retained separately, including their original control bytes.
        assert (fixture / "reports/типы-функции.txt").read_bytes() == (DIAGNOSTIC + "\n").encode()
        for name in ("tests-functions.junit.xml", "tests-web.junit.xml"):
            ET.parse(fixture / "reports" / name)
        assert "| File |" in (fixture / "reports/tests.log").read_text()
        print("✔ scripts/check: valid JSON/JUnit, exact diagnostics, exit", status)


if __name__ == "__main__":
    check_report(0)
    check_report(1)
