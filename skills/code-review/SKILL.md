---
name: code-review
description: Review code changes for security, performance, and correctness. Use when checking a change for N+1 queries, injection risks, missing edge cases, error handling gaps, or before merging. In the audit loop, use the code-review skill to produce every audit_review verdict.
---

# Code Review (audit loop)

Review code changes with a structured lens on security, performance, correctness, and maintainability. In the audit loop this skill defines how an `audit_review` verdict is produced: run the review below, then map the outcome onto the tool call (see *Verdict for the audit loop* at the end).

## Review Dimensions

### Security

- SQL injection, XSS, CSRF
- Authentication and authorization flaws
- Secrets or credentials in code
- Insecure deserialization
- Path traversal
- SSRF

### Performance

- N+1 queries
- Unnecessary memory allocations
- Algorithmic complexity (O(n²) in hot paths)
- Missing database indexes
- Unbounded queries or loops
- Resource leaks

### Correctness

- Edge cases (empty input, null, overflow)
- Race conditions and concurrency issues
- Error handling and propagation
- Off-by-one errors
- Type safety

### Maintainability

- Naming clarity
- Single responsibility
- Duplication
- Test coverage
- Documentation for non-obvious logic

## Scope

When a diff is available (e.g. the audit loop scope is `main..HEAD`), review the changed lines and their immediate context. When a file path is given, review the file, focusing on the parts the loop most recently touched.

**After `audit_change`, review the diff — not the files again.** Take the diff of the files the change listed (e.g. `git diff -- <files>`) and interrogate each hunk:

- For `kind=simplify`, does it change a return value, guard, operator, default, or error path? If so, it may change behavior.
- For `kind=fix`, does the new test express the intended behavior, fail before the fix, and pass after it? Does the fix stay within that behavior?
- Did the change remove or weaken a check?
- For `kind=simplify`, is it equivalent for *every* input, boundaries included? A rewrite that happens to satisfy the current tests is **not** evidence of equivalence.

If a simplification changes behavior, or a fix changes behavior beyond the stated defect, the verdict is `changes_requested` even when the test suite is green. Report the hunk and a concrete input that differs.

## Output

```markdown
## Code Review: [file or change]

### Summary
[1-2 sentence overview of the changes and overall quality]

### Critical Issues
| # | File | Line | Issue | Severity |
|---|------|------|-------|----------|
| 1 | [file] | [line] | [description] | 🔴 Critical |

### Suggestions
| # | File | Line | Suggestion | Category |
|---|------|------|------------|----------|
| 1 | [file] | [line] | [description] | Performance |

### What Looks Good
- [Positive observations]

### Verdict
[Approve / Request Changes / Needs Discussion]
```

## Verdict for the audit loop

Map the review onto the `audit_review` tool call:

| Review outcome | `audit_review` arguments |
|---|---|
| No actionable findings | `verdict=clean`, `findings=0`, `basis=<what was reviewed and why it passes>` |
| Initial behavior defect | `verdict=changes_requested`, `findings=<count>`, `route=fix`, `basis=<location, claim, evidence>` |
| Initial design or clarity finding | `verdict=changes_requested`, `findings=<count>`, `route=simplify`, `basis=<location, claim, evidence>` |
| Final actionable findings | `verdict=changes_requested`, `findings=<count>`, `basis=<location, claim, evidence>`; the run ends with open findings |

Rules that keep the loop honest:

1. A finding must be **actionable**: it names a concrete problem, a reason it matters, and a specific fix. Everything else is a suggestion, not a finding.
2. Do not file a finding for something a linter or formatter already catches, and do not file duplicate findings across passes.
3. An initial `clean` verdict still requires `audit_verify` before the run can complete. A final `clean` verdict requires review of the changed diff and tests; a green suite alone is insufficient.
4. Keep `basis` concise and tied to inspected code or an observed check. For `kind=simplify`, assess the whole changed diff for a net clarity gain; duplication moved into a helper or fewer lines alone is insufficient.
5. If a finding remains after the one change, report it in the final review. The run ends with open findings; start a new scoped run if further work is justified.

## Tips

1. **Provide context** — "This is a hot path" or "This handles PII" helps focus the review.
2. **Specify concerns** — "Focus on security" narrows the review.
3. **Include tests** — check test coverage and quality for the changed lines too.

---

*Vendored from [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) `engineering/skills/code-review/SKILL.md` @ `a6d8653` (Apache-2.0). Adapted for pi: dropped Claude Code `/command` syntax and connector references, added the audit verdict, route, and basis mapping, added the post-change diff review, and made a prose pass. See SOURCES.md.*
