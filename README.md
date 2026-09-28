# pi-audit-loop

A one-pass audit workflow for [pi](https://github.com/earendil-works/pi). Review a focused change, route one actionable finding to a behavior fix or a behavior-preserving simplification, verify, and inspect the resulting diff. Each run ends with an explicit outcome; another finding starts another run.

## Install

```bash
pi install npm:@plicara/pi-audit-loop
```

To try a local checkout, use `pi -e /path/to/pi-audit-loop`.

## Workflow

```text
start → initial review → fix or simplify → verify → final review → outcome
```

A clean initial review goes straight to verification and an outcome. A finding that receives no change ends as `open_findings`.

The initial review may consult current external documentation when an API, security claim, or standard is uncertain. It should first establish the expected behavior from the task and repository. Online research is conditional and does not add a tool or a mandatory phase.

| Tool | Purpose |
|---|---|
| `audit_loop_start` | Set one scope and an optional `test_command`; capture the Git baseline. |
| `audit_review` | Record the initial verdict and route, or the final diff verdict, with a concise `basis`. Use the vendored `code-review` skill. |
| `audit_change` | Record a `fix` or `simplify` change; Git supplies and reports the changed files. A no-op leaves findings open. |
| `audit_verify` | Run the configured command in the project directory and bind its exit status to the checked repository state. |
| `audit_loop_status` | Inspect phase, findings, review bases, verification, and outcome. |
| `audit_loop_stop` | Stop the run explicitly. |

For a behavior defect, write and observe a failing regression test before changing implementation, then make the smallest fix. For a simplification, preserve behavior and use the vendored `code-simplification` skill. Review the exact changed diff after verification; a passing suite alone does not establish correctness or behavioral equivalence.

Every `audit_review` call needs a `basis`. For a finding, give the location, claim, and evidence. For a clean verdict, say what was reviewed and why it passes. The initial and final bases remain in the saved audit state.

In a Python checkout with a local virtual environment, start with `test_command: ".venv/bin/python -m pytest -q"`. Pi runs that command from the active project directory, so the relative interpreter path follows a disposable checkout rather than a source repository.

## Outcomes and limits

`complete` requires a clean review and a passing configured check. `open_findings` means a finding remains after a no-op or final review. `checks_failed` means the configured check failed or the repository changed before, during, or after verification. `unverified` means no check was configured. `stopped` is a manual stop. These outcomes are stored in Pi's `audit_loop_state` session entries; resuming a session restores its last audit state from the active branch.

The extension requires a Git repository. It compares staged, unstaged, and untracked files with the baseline captured at start, including files already dirty before the audit. Verification fails if code changes after `audit_change` or the clean review, during the command, or before final review. Ignored files are outside this check; use a test command appropriate for the project. The extension cannot judge test quality, prove a fix correct, or prove a simplification preserves behavior. Keep each scope small enough for one change and one final review.

Version 0.4.0 removes the agent-supplied `changed` and `files` arguments from `audit_change` and requires Git evidence for new runs. In-progress sessions saved by older versions should be stopped and restarted. Version 0.3.0 requires `basis` in every `audit_review` call. Version 0.2.0 replaced the repeated `audit_simplify` cycle with `audit_change` and `audit_verify`.

## Development

```bash
make setup
make check
```

`make check` validates project metadata and runs TypeScript typecheck and tests. `npm run check` runs the TypeScript checks alone. The pure state machine lives in `src/phase-machine.ts`; `src/phase-machine.test.ts` and `src/extension.test.ts` cover the public transitions and Pi tool adapter.

## Sources and license

The two vendored skills and their upstream pins are documented in [SOURCES.md](SOURCES.md). The package is MIT; the vendored review skill retains Apache-2.0 and ships its license text.
