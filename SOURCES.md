# Sources

Everything vendored or pinned in this package, with refresh procedures.

## Vendored skills

Both skills are vendored into `skills/` (they ship inside the pi package so the
loop works offline and unchanged). Attribution footers are in each SKILL.md.

### skills/code-review

| | |
|---|---|
| Upstream | https://github.com/anthropics/knowledge-work-plugins `engineering/skills/code-review/SKILL.md` |
| Pinned rev | `a6d8653261a4` (2026-09-12) |
| License | Apache-2.0 (full text shipped at `skills/code-review/LICENSE`) |
| Adapted | dropped Claude Code `/command` syntax and connector references; added the audit-loop verdict mapping (verdict → `audit_review` arguments); prose pass for pi |

Refresh: `curl -fL https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/engineering/skills/code-review/SKILL.md -o skills/code-review/SKILL.md`, re-apply the two adaptations, update the pin + footer, run `npm run check`.

### skills/code-simplification

| | |
|---|---|
| Upstream | https://github.com/addyosmani/agent-skills `skills/code-simplification/SKILL.md` |
| Pinned rev | `be4e44a9fbc5` (2026-09-12) |
| License | MIT (author notes it was itself adapted from anthropics/claude-plugins-official `plugins/code-simplifier`) |
| Adapted | convention-file references generalized to `CLAUDE.md`/`AGENTS.md`; added the audit-loop verdict mapping; line-length pass |

Refresh: `curl -fL https://raw.githubusercontent.com/addyosmani/agent-skills/main/skills/code-simplification/SKILL.md -o skills/code-simplification/SKILL.md`, re-apply the adaptations, update the pin + footer, run `npm run check`.

## Development dependency pins

| Package | Pin | Why |
|---|---|---|
| `@earendil-works/pi-coding-agent` | `0.85.1` (dev) / `>=0.84.2` (peer) | Type surface for `ExtensionAPI` and tool registration; peer floor so the extension can't silently install on an incompatible runtime. |
| `typebox` | `1.3.7` (dev) / `*` (peer) | Tool parameter schemas. Pi bundles typebox for extensions, so it is declared as a peer dependency (see pi packages docs); the dev pin exists only for local typecheck. |
| `vitest` | `^3.2.4` | Test runner. |