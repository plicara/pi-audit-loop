# pi-audit-loop

An audit loop for [pi](https://github.com/earendil-works/pi): alternating
**code review** and **behavior-preserving simplification** until convergence.

The loop is a two-phase state machine that the extension enforces, not the
model. Each phase is defined by a vendored, vetted skill; the extension makes
sure the phases alternate and that the loop terminates.

## Install

```bash
# from the registry (once published)
pi install npm:@plicara/pi-audit-loop

# local dev / tryout without installing
pi -e /path/to/pi-audit-loop
```

## How the loop works

```
audit_loop_start  →  audit_review  →  audit_simplify  →  audit_review  →  …  →  done
```

| Tool | Phase | What it does |
|---|---|---|
| `audit_loop_start` | idle → review | Starts a loop on a scope (path, diff range, or description). Optional `test_command` is used as the verification gate. |
| `audit_review` | review | Records a review verdict produced with the **code-review** skill (`verdict=clean/changes_requested`, `findings`, `files`). |
| `audit_simplify` | simplify | Records a behavior-preserving simplification pass produced with the **code-simplification** skill (`changed`, `files`). |
| `audit_loop_stop` | any → done | Manual stop. |
| `audit_loop_status` | any | Show phase, round, and the expected next tool. |

### Enforcement (the part that makes it a machine, not a prompt)

- A wrong-phase call is rejected with the expected next tool (e.g.
  `audit_simplify` while in `review` fails with guidance).
- `verdict=changes_requested` with `findings=0` is rejected as
  self-contradictory.
- `changed=false` with files listed is rejected; `changed=true` without files
  is rejected.
- The loop terminates only through one of four gates:

  1. `review_clean` — a review found no actionable findings (and, per the
     skill, tests pass);
  2. `nothing_left` — a simplification pass changed nothing;
  3. `budget_exhausted` — `maxRounds` simplify passes ran with findings still
     open (default 3, configurable);
  4. `stopped` — manual stop.

Every state transition is appended to the session log as an `audit_loop_state` custom entry, giving a post-hoc audit trail and a future resume hook.

### What this enforces — and what it does not

The extension enforces the **shape** of the loop, not the **content** of the work.

| Enforced by the extension | The model's responsibility |
|---|---|
| Phase order; a wrong-phase call is refused | That a “simplification” actually preserves behavior |
| Contradictions in the recorded data (`findings`, `files`) | That a review's findings are correct and complete |
| The four termination gates | That the test suite was really run, and is worth running |

The extension cannot see the diff, so it cannot tell a simplification from an ordinary edit. Behavior preservation rests on the vendored `code-simplification` skill and on your test suite — and a suite can pass while a behavior change introduces a regression the tests do not cover.

That is why the review following a simplification examines **that pass's diff** rather than the files again. It is the difference between “the tests still pass” and “the change is equivalent”; the code-review skill's Scope section explains how. Treat a `review_clean` that follows a simplification as a claim to verify, not a fact.

## The skills

| Skill | Source | What it enforces |
|---|---|---|
| `code-review` | [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) `engineering/skills/code-review` (Apache-2.0, pinned) | Security / performance / correctness / maintainability review, verdict mapping, "no lint-nits, no duplicate findings, clean means verified". |
| `code-simplification` | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (MIT, pinned; in turn adapted by the author from [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) `plugins/code-simplifier`) | Behavior preservation, Chesterton's Fence, one simplification at a time with tests after each change, over-simplification red flags. |

Both are vendored (see [SOURCES.md](SOURCES.md) for pins and refresh).

## Why the "consensus ≠ correctness" gate matters

Review → simplify → review converges to a stable state, but if both phases
share the same blind spots the loop can agree with itself while staying wrong.
The loop is therefore **verification-gated**: the code-review skill requires a
passing test run before `verdict=clean`, and the code-simplification skill
requires tests to pass after every change. Running the loop without a test
suite weakens it — automate the check so the model can actually run it.

## Development

```bash
npm ci --ignore-scripts
npm run check        # typecheck + tests
npm test             # tests only
```

The phase machine (`src/phase-machine.ts`) is pure TypeScript with no pi
imports — every transition and gate is unit-tested in
`src/phase-machine.test.ts`, and the extension factory is injectable
(`machine` / `onStateChange` options) for integration tests.

## License

MIT — the vendored skills retain their own upstream licenses (Apache-2.0,
MIT); see the attribution footers and [SOURCES.md](SOURCES.md).