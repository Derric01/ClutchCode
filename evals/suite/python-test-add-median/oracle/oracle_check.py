"""Held-out check for the test-add task (PROJECT_SPEC.md §16.3b).

Written into the delivered repository AFTER the run finishes, so the agent
can neither read nor edit it. A test-add task cannot be graded by "do the
tests pass" alone — a file containing `assert True` passes too. So this
grades by mutation: the new tests must pass against the real stats.py, and
must FAIL against a stats.py whose median is deliberately broken.
"""

import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent
MUTATION_ANCHOR = "    ordered = sorted(values)\n"
MUTATION = "    ordered = sorted(values)\n    return ordered[0]\n"


def run_pytest(cwd):
    """Run the repository's test suite in `cwd`."""
    return subprocess.run(
        ["pytest", "-q", "tests"],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=False,
    )


def main():
    """Return 0 when the added median tests are real, non-zero otherwise."""
    added = ROOT / "tests" / "test_median.py"
    if not added.exists():
        print("FAIL: tests/test_median.py was not added")
        return 1

    green = run_pytest(ROOT)
    if green.returncode != 0:
        print("FAIL: the test suite does not pass\n" + green.stdout + green.stderr)
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        mutant = pathlib.Path(tmp) / "repo"
        shutil.copytree(
            ROOT,
            mutant,
            ignore=shutil.ignore_patterns(".git", "__pycache__", ".pytest_cache"),
        )
        source = (mutant / "stats.py").read_text()
        if MUTATION_ANCHOR not in source:
            print("FAIL: stats.py was modified, so the mutation check cannot run")
            return 1
        (mutant / "stats.py").write_text(source.replace(MUTATION_ANCHOR, MUTATION, 1))

        caught = run_pytest(mutant)
        if caught.returncode == 0:
            print("FAIL: the added tests still pass against a deliberately broken median")
            return 1

    print("ok - oracle: median tests added, and they catch a broken median")
    return 0


sys.exit(main())
