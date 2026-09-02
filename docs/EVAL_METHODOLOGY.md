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
so a failure can be inspected by hand; `--repetitions <K>` runs the whole
suite K times and pools every run into one board (§5).

The §16.4 A/B — the same model under ClutchCode against the same model
naked — is its own command, and it is the one that produces a *delta*:

```sh
node evals/dist/eval-bin.js ab \
    --provider ollama --model qwen2.5-coder:14b \
    --repetitions 5 \
    --out ~/.local/state/clutchcode/eval
node evals/dist/eval-bin.js ab-history ~/.local/state/clutchcode/eval
```

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

## 5. The A/B that substantiates the claim (§16.4)

`PROJECT_SPEC.md §16.1` states the reason this project exists: *"VTCR of a
14B-class local model **with the ClutchCode harness** materially exceeds
the same model's single-shot/naked VTCR … If that delta is not real and
measurable, the project has no reason to exist."* §16.4 turns it into an
experiment. Everything above measures one arm of it. This section is the
other arm and the comparison.

### 5.1 What the naked arm is

One model call. The task text plus the repository's files in the prompt.
Whole-file replies parsed out of the reply and written straight to disk.
Then the **same held-out oracle**. Nothing from the harness participates:

| ClutchCode arm | naked arm |
|---|---|
| tools (`read_file`, `search`, `shell`, `edit_file`) | none — the prompt is all the model gets |
| the §6 state machine and its repair iterations | one call, whatever comes back |
| §14 deterministic gate, with its failure fed back (§14.5) | no gate, no feedback |
| §14.6 cheat detection, §14.7 approval contract | neither |
| §4.4 edit-format selection + the SEARCH/REPLACE cascade | one fixed whole-file format |
| §4.5 context budgeting, §4.9 capability probe | a flat, generous output cap |
| §13 worktree isolation | writes directly into the delivered repository |

"Single-shot" is not a claim about the code, it is an assertion in the
tests: every end-to-end naked case checks the scripted server's own
request counter, because a naked arm that quietly grew a retry would look
fine on every other metric while inflating the delta.

### 5.2 The baseline is engineered to be *hard to beat*

A rigged baseline makes the delta worthless, and the failure mode is
asymmetric — it is very easy to build a naked arm that loses for reasons
that have nothing to do with the harness. Three choices push the other
way, and all three cost the ClutchCode arm:

1. **The naked arm gets the whole repository in its prompt** (to a stated
   byte budget), not a retrieved subset. Retrieval is a harness feature
   (§9); withholding files would score it twice. Anything dropped for
   size or being binary is *reported on the result*, so a weak naked
   score can never be a silent truncation artifact.
2. **The reply parser is deliberately tolerant.** A bare path line, a path
   in the fence info string, a backticked path, `File:`, a markdown
   heading, a `./` or `/` prefix — all accepted. A picky parser would
   score a formatting habit as a failure and the delta would be measuring
   our parser. Blocks it still cannot attribute are counted and reported,
   not silently dropped.
3. **The naked arm is graded on the held-out oracle alone.** The
   ClutchCode arm must *additionally* reach `DONE` with a green gate and
   zero cheat flags (§3.1's clauses 1–3) before its oracle result counts.
   That asymmetry favours the naked arm, which makes the published delta a
   conservative floor rather than a flattering number.

Model-produced paths are also untrusted text about to become filesystem
paths, so they go through the same shared validator the rest of the
codebase uses (`@clutchcode/git`'s `isSafeRelPath`) plus a containment
re-check and a `.git` refusal. Reproduced before it was written: without
the guard, a reply naming `../canary.txt` genuinely overwrites a file
outside the repository.

### 5.3 "K seeds" means K repetitions

§16.4 asks for repeated runs "because local models are nondeterministic".
Nothing here sets a provider-side seed — `NormalizedRequest` has no seed
field, and most local servers would ignore one anyway — so the knob is
`--repetitions K`: K independent runs of the whole comparison, pooled.
That is what actually averages over a model's run-to-run variance, and
calling it what it is avoids implying a reproducibility we do not have.

### 5.4 The intervals, and why these ones

**Per-arm VTCR gets a Wilson score interval.** These boards sit at 0% and
100% constantly, and the textbook Wald interval collapses to zero width
exactly there — reporting infinite confidence from ten observations.
Wilson does not: 0/10 is `[0, 0.278]`, not `[0, 0]`. The implementation is
tested against published reference values.

**The delta gets a cluster bootstrap over tasks.** The observations are
paired — same task, same repetition, both arms — and correlated within a
task: an easy task is easy in both arms, K times over. Treating
`tasks × repetitions` Bernoulli trials as independent would understate the
interval by exactly the amount that matters. Each resample therefore draws
whole **tasks** with replacement, keeping each task's repetitions
together. No distributional assumption is needed, and the PRNG is seeded
and the seed recorded on the report, so a published interval is one anyone
can recompute.

The honest consequence, and it is attached to every report rather than
buried here: **with a five-task suite the interval is wide and coarse**,
and a zero-width one means every resample agreed, not that the estimate is
precise. That is what five tasks can support. Growing the suite (§16.3a)
narrows it; a different formula does not. A report whose 95% interval
includes 0 says so in its own notes — on its own, such a run does not
substantiate §16.1's claim.

### 5.5 What a report contains

Both arms' VTCR with Wilson intervals, the delta with its bootstrap
interval, the bootstrap's resample count and seed, per-task solved counts
in each arm (so the headline can be re-derived by hand from the report
alone), and the notes above. `ab --out <dir>` writes the full report as
JSON, appends the headline numbers to `ab.jsonl`, **and** writes the
ClutchCode arm's own §16.2 board next to it — the supporting metrics are
what explain a delta, and a delta without them is a number without a
mechanism.

---

## 6. Conditions every scored run holds fixed

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

## 7. Is the suite itself any good?

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

## 8. What is deliberately not here yet

Stated plainly, because silence would imply completeness.

* **A measured delta for a real model.** The A/B itself now exists (§5):
  both arms, the same held-out oracle, K repetitions, and a delta with
  confidence intervals. What does not exist is a *number*. Every scored run
  in this repository is against scripted replies or `--provider fake`,
  because this project's environment has no local model server and no API
  key. So: the machinery is verified end to end, and **no VTCR delta for
  any real model is published here or may be quoted from this harness**.
  Running it against a 14B-class model on a machine that has one is the
  remaining step, and it needs no code.
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
* **A suite large enough for a tight interval.** Five tasks is enough to
  detect a large delta and not enough to resolve a small one — see §5.4.
  §16.3a's other two bullets are what grow it.
* **Cost.** See §3.2 — it turns on by itself the day a provider adapter
  reports one.
