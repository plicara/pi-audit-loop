## DEC-002: Keep review evidence and restore audit state

- **Date:** 2026-09-27
- **Status:** decided
- **Context:** The first dogfood round showed that a finding count and route did not preserve the reason for a review. A later multi-scope Pi round showed that reopening a session reset the in-memory audit to idle even though Pi had saved the transition snapshots.
- **Options considered:**
  - Add more graph phases or reviewers: more process without making the existing verdicts inspectable.
  - Keep only prose in the model conversation: simple, but the extension cannot show the basis through its status tool or restore its state.
  - Require one review basis and restore the latest saved state on the active session branch: a small addition to the existing tools and journal.
- **Decision:** Require a concise `basis` in every `audit_review`, retain the initial and final bases in session state, and restore the last valid audit snapshot from the active Pi branch on session start. Keep research conditional and require a concrete net clarity gain for simplification.
- **Consequences:** Version 0.3.0 changes the `audit_review` tool schema. A session can continue an in-progress audit after restarting Pi; a fresh session starts idle. The basis makes a claim inspectable but does not prove the claim is true, and the simplify rule still requires judgment in the final diff review.
