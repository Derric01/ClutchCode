# Cross-cutting: Edit-format comparison

Synthesized from direct reads (Aider `editblock_coder.py`, Codex `apply-patch/`) + repo notes. Edit-application accuracy is the strongest empirical predictor of coding-agent success, so this is the most important cross-cutting analysis. Feeds PROJECT_SPEC §4.3–4.4.

## What each project uses

| Project | Primary edit format | Application/repair | Fuzzy? |
|---|---|---|---|
| Aider | SEARCH/REPLACE (also whole-file, udiff, patch) | exact→whitespace→blank-line→dotdotdots cascade (`editblock_coder.py:127-240`) | **disabled on purpose** (`:183`) |
| Codex | bespoke `apply_patch` (hunks) | streaming parser + **seek_sequence** tolerant locate + verify-args | tolerant seek (bounded) |
| Cline / Roo / Kilo | SEARCH/REPLACE via `<replace_in_file>`; whole-file via `<write_to_file>` | exact + tolerant; re-prompt on fail | limited |
| OpenHands | LLM-based / `openhands-aci` str-replace + whole-file | model-driven | n/a |
| smolagents | code-as-action (writes Python) | sandboxed exec | n/a |
| SWE-agent | custom line-window editor command + lint-on-edit | command-level | n/a |

## Failure modes (why format choice matters)

| Format | Dominant failure |
|---|---|
| Whole-file | truncation at token limit; silent drift in untouched regions; expensive on big files |
| Unified diff | hallucinated context lines; line-number drift; models miscount hunks |
| SEARCH/REPLACE | SEARCH must match char-for-char → whitespace drift, ambiguous multi-match, omitted lines |
| Line-anchored | anchor ambiguity; drift after a prior edit shifts lines |
| JSON edits | JSON-escaping code (quotes/newlines) breaks weak models; verbose |
| Code-as-action | hardest to constrain on weak models; powerful on strong ones |

## The decisive lesson (verified)
Aider **removed** fuzzy edit-distance application (early `return` at `editblock_coder.py:183`) because "apply to the closest match" silently edits the wrong place. **Do-not-copy** across the board: no silent fuzzy apply. Tolerances (whitespace, blank line, bounded context seek) are fine; "nearest guess" is not.

## Recommendation for ClutchCode (→ §4.4)
- Default **SEARCH/REPLACE** (interoperable convention; marker syntax not protectable, matching code clean-room).
- Apply cascade: exact → uniform-whitespace → drop-blank-line → explicit `...` elision → **fail loud + structured repair prompt** (which block failed, current window) → **downgrade to whole-file** after N failures → **escalate to human**; never fuzzy-guess.
- **Format selected per model** from the capability profile (`diff_acc`); whole-file for new/tiny files and weakest models, capped by effective context.
- **Constrained decoding (GBNF/JSON-schema)** enforces the block/patch grammar at decode time for local models — the single biggest reliability lever (§4.8).
