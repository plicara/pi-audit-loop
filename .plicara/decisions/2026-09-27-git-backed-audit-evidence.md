## DEC-003: Bind audit claims to Git and the checked revision

- **Date:** 2026-09-27
- **Status:** decided
- **Context:** Dogfood showed that the one-pass graph behaved correctly, but `audit_change` trusted an agent-supplied file list and a passing command could be followed by further edits. The user asked for deterministic checks without adding graph complexity.
- **Options considered:**
  - Add new review and verification phases: more ceremony and agent calls without improving the evidence source.
  - Require a clean checkout and compare against HEAD: simple, but it would reject normal work on a dirty checkout.
  - Capture the Git state at start and bind each existing transition to observed changes and the checked revision: small state growth with a clear trust boundary.
- **Decision:** Keep the existing graph. Capture a Git baseline, derive changed paths from repository state, and fail verification when the repository changes after change recording, during the test command, or before final review. Do not add mandatory coverage, mutation, or complexity scores.
- **Consequences:** Version 0.4.0 requires Git for new runs and removes `changed` and `files` from the agent-facing `audit_change` tool. Pre-existing edits remain allowed; ignored files are outside the Git check. A passing command is evidence about one revision and does not prove that its tests specify the right behavior.
