# Long-horizon dogfood of 0.3.0

Pi ran `opencode-go/mimo-v2.6-flash` with the local extension and bundled skills in disposable copies under `/private/tmp/pi-audit-long.G44jne`. The research profile isolated the audit package; one compatibility run used the basic profile alongside its web and subagent extensions. The original repositories in `Testing/` remained clean. All changes below are confined to disposable copies.

The sqlite-utils and Agentic-Workbench runs each handled three consecutive audits in one Pi process. Their JSON traces are `sqlite-run.jsonl` and `workbench-run.jsonl` in the disposable root. Both reached all requested outcomes without a graph-state failure. These are model trajectories and local checks, not proof that every patch is production-ready.

| Run and scope | Observed outcome | Independent check |
|---|---|---|
| sqlite-utils: CLI `rows --limit 0` | `fix`, then `complete`; regression test failed before code change | Two cases failed before the fix; full suite after fix: 1,487 passed, 19 skipped; diff changes the CLI limit checks and adds two cases |
| sqlite-utils: WAL methods | `simplify`, then `complete`; a private helper replaced two short method bodies | Full suite: 1,487 passed, 19 skipped; the diff preserved tested behavior, but its net clarity gain is debatable because it adds indirection |
| sqlite-utils: `enable-counts` errors | `fix`, then `complete`; views and virtual tables now produce CLI errors rather than raw exceptions | Two cases failed before the fix; full suite after fix: 1,489 passed, 19 skipped |
| Agentic-Workbench: suppression fingerprints | `fix`, then `complete`; empty claims no longer auto-match a dismissed empty claim | One regression failed before the fix; full suite after fix: 107 passed; the finding matches `TASK-0011`'s written plan |
| Agentic-Workbench: routing simplification | Initial review `clean`, no edit, then `complete` | The review basis rejects three candidate refactors with specific clarity costs; full suite: 107 passed |
| Agentic-Workbench: inspectable bundle references | `fix`, then `complete`; schema, absolute-path, and repository-containment checks added | Two regressions failed before the fix; full suite after fix: 109 passed |
| Basic-profile compatibility: routing warning | `fix`, then `complete`; unconfigured reviewer families no longer produce a misleading shared-family warning | Two cases failed before the fix; focused suite: 5 passed; one malformed `audit_review` call was rejected and recovered |
| Focused WAL retest after stronger simplify guidance | Initial review `clean`, no edit, then `complete` | Full suite: 1,485 passed, 19 skipped; the basis explicitly rejects the new helper as moved duplication with extra indirection; two unnecessary `audit_change(changed=false)` calls were rejected without changing state |
| WAL UX retest after clarifying the tool descriptions | Initial review `clean`, no edit, then `complete` | Focused suite: 6 passed; Pi called `audit_verify` directly after the clean review with no rejected tool call |

The basic profile loaded the audit tool alongside its existing extensions. Its web extension printed a startup warning that dynamic activation was unavailable and left web tools eagerly available; no audit tool collision or broken transition was observed. This warning came from `pi-web-access`, not `pi-audit-loop`.

A separate process restart revealed a package defect: `audit_loop_status` showed `idle` when reopening a completed session, even though Pi had saved `audit_loop_state` entries. The extension now restores the latest valid snapshot on the active session branch. A live resume reported `done_reason=complete` and both saved review bases; a fresh session reported `idle`. A package test also resumes an audit in its `change` phase and completes it after restoration.

The first WAL retest still made rejected no-op calls after a clean review. The tool descriptions were clarified to reserve `audit_change` for an initial `changes_requested` verdict and send a clean initial review directly to `audit_verify`. A second WAL run with that wording followed the clean path without a rejection. The simplification skill's overlapping no-op guidance was aligned afterward. This is one model run, not evidence that the wording will prevent every future mistaken call; the state machine still enforces the route.

## Figure trace

| Claim | Source |
|---|---|
| Three scopes each in the two long runs | `audit_loop_start` and terminal `audit_review`/`audit_verify` events in `sqlite-run.jsonl` and `workbench-run.jsonl` |
| sqlite-utils red and green counts | Bash tool results for the focused tests and `audit_verify` results in `sqlite-run.jsonl` |
| Agentic-Workbench red and green counts | Bash tool results for the focused tests and `audit_verify` results in `workbench-run.jsonl` |
| Basic-profile focused result and rejected call | `audit_verify` and `audit_review` results in `compat-run.jsonl`; extension warning in `compat-stderr.txt` |
| WAL retest result and rejected no-op calls | `audit_review`, `audit_change`, and `audit_verify` results in `wal-retest-run.jsonl`; clean checkout from `git status --short` |
| WAL UX retest result and direct clean path | `audit_review`, `audit_verify`, and `audit_loop_status` results in `wal-ux-run.jsonl`; clean checkout from `git status --short` |
| Session restart before and after fix | `audit_loop_status` results in `compat-resume.jsonl`, `compat-resume-fixed.jsonl`, and `new-session-run.jsonl` |
| Original Testing repositories clean | `git status --short` in both original repositories after the runs |
