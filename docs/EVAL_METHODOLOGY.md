# Eval methodology

How ClutchCode measures itself, stated precisely enough to be argued with.

`PROJECT_SPEC.md §16` makes the case that *a harness with no eval loop
cannot be improved*, and §16.4 commits to publishing the methodology "so
the claim is falsifiable". This document is that publication. It describes
what is measured, how, what each number does **not** mean, and what is
still missing — including the parts of §16 that are deliberately not built
yet.

Everything here runs **locally and offline**. There is no leaderboard
service, no upload, no telemetry (ADR-013): a scoreboard is a JSON file on
your disk.

---

## 1. Running it

```sh
pnpm build
node evals/dist/eval-bin.js list                       # what's in the suite
node evals/dist/eval-bin.js run \
    --provider ollama --model qwen2.5-coder:14b \
    --out ~/.local/state/clutchcode/eval                # run it, save the board
node evals/dist/eval-bin.js history ~/.local/state/clutchcode/eval
```

`--task <id>` (repeatable) narrows the run; `--json` prints the whole board
for a script; `--keep-workdir` leaves each task's scratch repository behind
so a failure can be inspected by hand.

`agent eval` (`§18.2`) does not exist yet, on purpose. §20's dependency
rule — "`apps/*` depend only on `agent-api`" — is normative, and the
scoreboard lives in `evals/` per §20's own layout, so wiring a CLI
subcommand on top of it is a package-boundary decision rather than an
implementation detail. It is queued as its own item.

---

## 2. What a task is

A task is a directory, not a database row:

```
evals/suite/<task-id>/
  task.json     id, category, language, prompt, solutionPaths, startingGate, oracle command
  repo/         the starting repository — copied into a fresh git repo and committed
  oracle/       the HELD-OUT check — copied into the delivered repo only AFTER the run
  solution/     the reference ("golden") solution, used only to validate the task itself
```

The suite that ships is §16.3a's **third** bullet: "a hand-built suite of
realistic individual-developer repo tasks (bug fix, small feature,
refactor, test-add, dependency bump) across languages — THE most
representative for our user." Five tasks, five categories, two languages
(Node and Python):

| Task | Category | Starting gate | What it is really testing |
|---|---|---|---|
| `node-bugfix-duration` | bug-fix | **red** | The ordinary case: a failing suite, a one-line cause. |
| `node-feature-slugify` | feature | green | A no-op scores a green gate. Only the oracle can tell. |
| `node-refactor-format` | refactor | green | Behavior preservation *and* the structural goal. |
| `python-test-add-median` | test-add | green | Graded by mutation — see §4. |
| `node-dependency-bump-textutil` | dependency-bump | green | A pin *and* a call-site migration, offline. |

### Why the oracle is held out

The agent's own deterministic gate (§14.1) runs **the repository's own
commands, on files the agent can read and edit**. Grading with it alone
would be grading the agent on a test it is allowed to rewrite. So each
task carries a separate check that is copied into the delivered repository
only *after* the run has finished and been approved — the same reason
SWE-bench applies its golden *test* patch after the model's patch rather
than before.

The held-out check is what makes the difference between these two
observable, and the second one is not hypothetical: it is what the shipped
`--provider fake` smoke run actually produces.

* **verified** — gate green, no cheat flags, and the held-out oracle agrees.
* **false completion** — gate green, no cheat flags, run reached `DONE`,
  and the oracle says nothing was actually solved.

### Why `startingGate` is declared, not inferred

Four of the five tasks arrive with a **green** gate. That is deliberate. A
suite made entirely of red-on-arrival tasks would quietly overstate VTCR,
because a red gate hands the agent a signal to chase; a green one hands it
nothing. Each task declares which it is, and the suite-validity test fails
if reality disagrees.

---

## 3. Metrics

### 3.1 North Star: VTCR (§16.1)

**Verified Task Completion Rate** = solved / total, where *solved* means
all of:

1. the run reached `DONE`,
2. the deterministic gate was green at the last verification,
3. zero cheat flags fired (§14.6), and
4. **the held-out oracle passed against the delivered repository.**

Clauses 1–3 are §16.1's own words. Clause 4 is this harness's reading of
"the deterministic verification gate passes" *for an eval task* — stated
here rather than assumed, because it is the clause that does the work. A
board also reports `claimedDoneRate` (1–3 only) and `falseCompletionRate`
(1–3 true, 4 false) so the gap is always visible rather than averaged away.

"Delivered" means the repository as it stands after the run: under `--yes`
semantics (§14.7) a green, cheat-free run auto-approves and merges its
worktree, and a run that escalates or fails merges nothing. An agent that
did excellent work and then escalated scores zero, which is the intended,
honest reading of *verified* completion.

### 3.2 Supporting metrics (§16.2)

| § | Metric | How it is computed | Caveat |
|---|---|---|---|
| #1 | Edit-format accuracy | applied `edit_file`/`write_file` calls ÷ attempted | `null` when a run attempted no edits at all. |
| #2 | Cheat rate | flags ÷ tasks, plus the share of tasks drawing any flag | See below — the literal phrasing is degenerate. |
| #3 | Cost per solved task | total cost ÷ solved | **`null` today.** No provider adapter reports a per-request cost, so a number here would be a measured-looking zero. |
| #3 | Wall-clock per solved task | total wall-clock ÷ solved | Measured around the whole run, so it includes verification, not just model time. `null` when nothing was solved. |
| #4 | Human-intervention rate | share of runs ending `ESCALATED` or `AWAITING_APPROVAL` | |
| #5 | Retrieval sufficiency | share of tasks that failed the oracle *without* the run ever touching a declared solution path | Heuristic — see below. |

**On #2.** §16.2 words it as "cheat flags per *solved* task". Under §14.7's
own completion contract that is identically zero and can never regress: a
cheat flag forces `ESCALATED`, so a flagged run is never a solved run. The
board therefore reports **flags per task** and **share of tasks flagged**,
which ask the same question non-degenerately. This is a deliberate
deviation from the spec's literal wording, recorded here rather than
silently applied.

**On #5.** "Failed due to missing context" is not directly observable, so
it is approximated: each task declares the file(s) a correct solution must
touch, and a failure counts as retrieval-insufficient when the run's tool
calls never mention any of them. It explains failures; it grades nothing.
A run that read the right file and still got it wrong is a reasoning
failure, not a retrieval one, and is counted as such.

---

## 4. Grading a test-add task

"Did the tests pass?" is not a grade for a task whose deliverable *is* a
test — a file containing `assert True` passes too. `python-test-add-median`
is graded by **mutation** instead. Its oracle:

1. requires the new test file to exist,
2. requires the whole suite to pass against the real implementation, and
3. copies the repository, replaces `median` with a deliberately broken one,
   and requires the suite to **fail**.

A test that cannot fail is not a test, and step 3 is the only step that can
tell the difference.

---

## 5. Conditions every scored run holds fixed

* **Trusted repo (§12.4).** Fixture repos are marked trusted and the flag
  is committed *before* the run, because `handleDirtyTree` stashes an
  uncommitted working tree at run start. Untrusted mode turns every
  first-use `EXECUTE` into an `ASK` (§12.2), which in a non-interactive
  benchmark would score the approval policy rather than the agent.
* **`--yes` semantics (§14.7).** No human is at the keyboard, so a run
  auto-approves on exactly the terms `--yes` gives a user: green gate plus
  zero cheat flags. Nothing else is relaxed.
* **Bounded budgets (§6.3).** 40 steps and 10 minutes per task by default,
  so one bad model cannot hang the suite.
* **Isolated state.** Each task gets its own state directory, capability-
  profile directory and project-memory directory inside its scratch
  workspace, so no task can read or write the machine's real `~/.config`
  state, and no task can leak into the next.
* **Sequential execution.** Tasks share a CPU; a wall-clock metric measured
  under contention is not a measurement.

---

## 6. Is the suite itself any good?

A benchmark can rot silently — every *scored* run still produces a
plausible number. So the suite is validated on every test run
(`evals/src/eval-suite.test.ts`), with no model in the loop, against real
repositories and real command execution. For each task:

1. the held-out oracle **fails** on the pristine repository (the task is
   genuinely unsolved — otherwise it would score a free point),
2. the oracle **passes** once the reference solution is applied (the task
   is genuinely solvable, and the oracle is not impossible),
3. the repository's own gate is **green** after the reference solution (a
   golden solution that leaves the gate red could never be reached through
   §14.7 at all), and
4. the declared `startingGate` matches what the gate actually does.

This has already earned its keep: it caught an arithmetic error in one
oracle's own expectations on its first run.

---

## 7. What is deliberately not here yet

Stated plainly, because silence would imply completeness.

* **The A/B that substantiates the product claim (§16.4).** The North Star
  claim is that a 14B-class local model *under ClutchCode* materially beats
  the same model naked. This harness measures the ClutchCode arm. The
  **naked arm** — one model call, no repair loop, no verification feedback
  — is not built, so no VTCR *delta* is published, and none should be
  quoted from this harness.
* **No numbers for a real model are published in this repository.** The
  only scored runs that exist so far are the deterministic, scripted ones
  in the test suite and a `--provider fake` smoke run. Running the suite
  against a real model needs an API key or a local server, neither of which
  exists in this project's CI environment. Any published VTCR figure must
  say which model, which suite revision, and how many seeds.
* **SWE-bench Verified subset and Terminal-Bench-style tasks** (§16.3a
  bullets 1 and 2). Both need dataset fetching and, for SWE-bench, per-
  instance container images — network and infrastructure this offline,
  local-first harness does not currently take on. The task format above is
  the intended adapter target; nothing about it is Node- or
  Python-specific.
* **Repeated runs and confidence intervals.** §16.4 asks for K seeds
  because local models are nondeterministic. The runner executes a suite
  once. Averaging over seeds is an additive change to the same board.
* **Cost.** See §3.2 — it turns on by itself the day a provider adapter
  reports one.
