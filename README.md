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
| `audit_loop_start` | Set one scope and an optional `test_command`. |
| `audit_review` | Record the initial verdict and route, or the final diff verdict. Use the vendored `code-review` skill. |
| `audit_change` | Record a `fix` or `simplify` change and its files. A no-op leaves findings open. |
| `audit_verify` | Run the configured command in the project directory and record its exit status. |
| `audit_loop_status` | Inspect phase, findings, verification, and outcome. |
| `audit_loop_stop` | Stop the run explicitly. |

For a behavior defect, write and observe a failing regression test before changing implementation, then make the smallest fix. For a simplification, preserve behavior and use the vendored `code-simplification` skill. Review the exact changed diff after verification; a passing suite alone does not establish correctness or behavioral equivalence.

## Outcomes and limits

`complete` requires a clean review and a passing configured check. `open_findings` means a finding remains after a no-op or final review. `checks_failed` means the configured check failed. `unverified` means no check was configured. `stopped` is a manual stop. These outcomes are stored in Pi's `audit_loop_state` session entries.

The extension enforces phase order, route consistency, and the observed exit status of its own verification command. It cannot judge the quality of a test, prove that a fix is correct, or prove that a simplification preserves behavior. A command can modify files while running; use a verification command appropriate for the project. Keep each scope small enough for one change and one final review.

This version replaces the repeated `audit_simplify` cycle with `audit_change` and `audit_verify`. It is a breaking workflow change from 0.1.x.

## Development

```bash
make setup
make check
```

`make check` validates project metadata and runs TypeScript typecheck and tests. `npm run check` runs the TypeScript checks alone. The pure state machine lives in `src/phase-machine.ts`; `src/phase-machine.test.ts` and `src/extension.test.ts` cover the public transitions and Pi tool adapter.

## Sources and license

The two vendored skills and their upstream pins are documented in [SOURCES.md](SOURCES.md). The package is MIT; the vendored review skill retains Apache-2.0 and ships its license text.

Project context lives in [.plicara/README.md](.plicara/README.md), and repository instructions live in [AGENTS.md](AGENTS.md).
