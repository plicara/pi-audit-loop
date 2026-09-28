# Cross-language dogfood of 0.4.0

Pi used `opencode-go/mimo-v2.6-flash` and the local extension in ten disposable checkouts under `/private/tmp`: two each in C, Rust, Go, TypeScript, and Python. The Python checkouts were copies of repositories under `Testing/`; both originals remained clean. Each checkout had a real configured test command, and several ran sequential audit scopes in one Pi process. Temporary seeded bugs are identified below; changes to target packages stayed in the disposable copies.

The ten-package sweep recorded 28 audit starts and 28 terminal outcomes: 22 `complete`, four `checks_failed`, and two `open_findings`. The failed/open outcomes are retained alongside later successful retries; they are not counted as successes. The base-profile compatibility retry and final itoa tool-response smoke are separate from these sweep counts.

The audit package did not acquire language-specific runners. It observed Git state and invoked each project's configured command. That kept the graph unchanged while testing phase order, dirty baselines, source and test edits, provider-session recovery, and post-verification drift across different toolchains.

| Checkout | Audits and observed outcome | Independent check |
|---|---|---|
| cJSON (C) | Two: BOM length guard finding ended `open_findings` after Pi called `audit_change` before editing; a new audit reviewed the resulting fix and completed. This was an unseeded upstream finding. | The regression fails against pristine source and `make test` passes with the one-line guard fix. |
| zlib (C) | Two clean audits of Adler-32 boundaries and `gzread` EOF/error handling completed. Configure had dirtied `Makefile` and `zconf.h` before the audits, exercising the dirty-baseline path. | `make test` passes. |
| itoa (Rust) | Two clean audits completed. A separate seeded sign-byte regression produced an early `open_findings` outcome when Pi called `audit_change` before editing; Pi then ran a clean audit, a fix audit, and a differential-formatting audit to completion. | Seeded bug fails three existing signed-minimum tests; `cargo test --quiet` passes after the fix. |
| Ryu (Rust) | First audit ended `checks_failed` because Pi added a test probe after a clean review; the retry and a separate negative-zero/subnormal audit completed. | `cargo test --quiet` passes with the probes. |
| GJSON (Go) | `GetMany` audit completed clean. `ValidBytes` audit found a deep-nesting crash and completed a fix after resuming from a provider timeout; the saved `review` phase restored. | Uncached `go test -count=1 ./...` passes. |
| SJSON (Go) | The first `SetRaw` audit ended `checks_failed` because Pi edited source after `audit_change`. A `Delete` audit also ended `checks_failed` when Pi added probes after a clean review. Fresh audits of both finished scopes completed. | Uncached `go test -count=1 ./...` passes in both the final dogfood checkout and a separate copy of the proposed patch without temporary probes. |
| Ky (TypeScript) | Seeded typed-array view-size regression was fixed and reviewed; a FormData audit completed clean. | Focused build and body-size suite: 22 passed. Full `npm test` could not bind a test server in the sandbox (`listen EPERM`) before the audit. |
| PQueue (TypeScript) | Seeded `size` getter regression was fixed and reviewed; a `pending` getter audit completed clean. | Full `npm test`: 206 passed. |
| sqlite-utils (Python) | Unseeded CLI `rows --limit 0` finding was fixed and reviewed. The stdin encoding-error fix passed verification, but a later formatting edit made the final review stale; a new audit reviewed the finished diff and completed. | Full pytest suite after both edits: 1,488 passed, 19 skipped. |
| Agentic-Workbench (Python) | Seeded suppression fingerprint regression was fixed and reviewed; reviewer-family routing audit completed clean. | Full pytest suite: 106 passed. |

The base Pi profile also loaded the audit extension alongside its normal web and subagent extensions. A concurrent edit to this package invalidated the first clean review before verification; a stable retry completed with `npm run check` passing. No tool collision or startup warning was observed.

After aligning the bundled skills with the new `audit_change` API, a final live itoa smoke run used a fresh seeded sign regression and the updated extension. Pi followed finding → edit → `audit_change` → verification → final review to `complete`; `audit_change` returned `changed_files=["src/lib.rs"]`. An independent offline Cargo test passed afterward, and the temporary checkout returned to a clean Git state.

The strongest deterministic result was refusal to treat an edited tree as checked. Ryu's new probe after a clean review, SJSON's edits after `audit_change`, sqlite-utils' edit after verification, and the base-profile concurrent edit all produced recorded failures before a false `complete` result. The GJSON timeout recovered the saved phase in a new Pi process. Pi also made rejected calls after completed audits and, in one long sqlite-utils run, investigated a nonexistent failing test before invoking `audit_verify`; the extension did not record the imagined result. These are agent behavior and workflow costs that the package cannot eliminate by checking Git.

## Figure trace

| Claim | Value | Producing source or command | Verified |
|---|---:|---|---|
| Language split | 10 checkouts, two each in five languages | Ten `/private/tmp/pi-audit-sweep-*` Git checkouts and their build files | Yes |
| Sweep audit outcomes | 28 starts; 22 complete, four checks failed, two open findings | Count `audit_loop_start` and terminal `audit_review`, `audit_verify`, or `audit_change` tool results in `/private/tmp/pi-audit-sweep-*-run.jsonl`; include `/private/tmp/pi-audit-sweep-gjson-resume.jsonl` for the resumed outcome | Yes |
| Seeded Rust red result | Three signed-minimum tests failed | Offline `cargo test --quiet --offline` in `/private/tmp/pi-audit-final-itoa-smoke` before Pi's fix | Yes |
| Ky focused result | 22 passed | `npm run build` and `./node_modules/.bin/ava test/body-size.ts` in `/private/tmp/pi-audit-sweep-ky` | Yes |
| PQueue full result | 206 passed | `npm test` in `/private/tmp/pi-audit-sweep-p-queue` | Yes |
| sqlite-utils full result | 1,488 passed, 19 skipped | Independent pytest output in `/private/tmp/pi-audit-sqlite-independent-final.txt` | Yes |
| Agentic-Workbench full result | 106 passed | Independent pytest in `/private/tmp/pi-audit-sweep-agentic-workbench` | Yes |
| GJSON and SJSON full results | Both passed | `GOCACHE=/private/tmp/pi-audit-go-cache GOPATH=/private/tmp/pi-audit-gopath go test -count=1 ./...` in each final checkout | Yes |
| Package check | 33 passed | `UV_CACHE_DIR=/private/tmp/pi-audit-uv-cache make check` in `pi-audit-loop` | Yes |
| Base-profile interaction | One invalidated audit, one complete retry | `/private/tmp/pi-audit-basic-profile-run.jsonl` and `.err` | Yes |
| Final tool-response smoke | One complete audit | `/private/tmp/pi-audit-final-itoa-smoke.jsonl`; independent offline Cargo test | Yes |
| Original Testing checkouts unchanged | No Git status entries | `git status --short` in the original sqlite-utils and Agentic-Workbench directories | Yes |
