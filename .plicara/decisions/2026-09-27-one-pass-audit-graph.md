## DEC-001: Use a one-pass audit graph

- **Date:** 2026-09-27
- **Status:** decided
- **Context:** The 0.1.x review/simplify loop forced correctness findings into behavior-preserving simplification and could report completion when findings remained. The redesign needed to support test-first fixes while keeping the package small.
- **Options considered:**
  - Continue the alternating review/simplify loop: few changes, but no valid behavior-fix route.
  - Add mandatory research and TDD phases to every run: more steps even when no external facts or behavior change are involved.
  - Use a bounded graph with conditional research and one selected change: a small state machine with explicit outcomes.
- **Decision:** Use one initial review, route a finding to a fix or simplification, run one configured verification command, and perform a final diff review after a change. Online research remains conditional guidance in the review skill. A new finding starts a new run.
- **Consequences:** The extension adds `audit_change` and `audit_verify` and removes `audit_simplify`; this is a breaking 0.2.0 workflow change. A run may end with `open_findings`, `checks_failed`, or `unverified`. The machine enforces transitions and command exit status, while test quality and review correctness remain human and agent responsibilities. A local Pi comparison should be run before publication.
