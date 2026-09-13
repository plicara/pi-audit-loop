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

When a diff is available (e.g. the audit loop scope is `main..HEAD`), review the
changed lines and their immediate context. When a file path is given, review the
file, focusing on the parts the loop most recently touched.

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
| No actionable findings | `verdict=clean`, `findings=0` |
| Findings that should block merge | `verdict=changes_requested`, `findings=<count>` |
| Needs discussion | `verdict=changes_requested`, `findings=<count>` (discussion points count as findings) |

Rules that keep the loop honest:

1. A finding must be **actionable**: it names a concrete problem, a reason it matters, and a specific fix. Everything else is a suggestion, not a finding.
2. Do not file a finding for something a linter or formatter already catches, and do not file duplicate findings across passes.
3. Run the test suite (or the loop's `test_command`) before returning `verdict=clean`. Clean means *verified clean*.
4. The loop's convergence depends on this: if a simplification genuinely resolved the previous findings, say so in the review summary instead of re-filing them.

## Tips

1. **Provide context** — "This is a hot path" or "This handles PII" helps focus the review.
2. **Specify concerns** — "Focus on security" narrows the review.
3. **Include tests** — check test coverage and quality for the changed lines too.

---

*Vendored from [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) `engineering/skills/code-review/SKILL.md` @ `a6d8653` (Apache-2.0). Adapted for pi: dropped Claude Code `/command` syntax and connector references, added the audit-loop verdict mapping. See SOURCES.md.*