import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuditLoopExtension } from "../extensions/index.ts";
import defaultExtension from "../extensions/index.ts";

interface ToolResult {
	content: Array<{ type: string; text: string }>;
	isError?: boolean;
}

interface Tool {
	name: string;
	execute: (id: string, params: Record<string, unknown>, signal: AbortSignal, update: unknown, ctx: { cwd: string }) => Promise<ToolResult>;
}

function repository() {
	const cwd = mkdtempSync(join(tmpdir(), "pi-audit-test-"));
	execFileSync("git", ["init", "-q", cwd]);
	writeFileSync(join(cwd, "parser.ts"), "export const parse = () => 1;\n");
	writeFileSync(join(cwd, "a.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "."], { cwd });
	execFileSync("git", ["-c", "user.name=Adrian Tame", "-c", "user.email=31286933+AdrianTJ@users.noreply.github.com", "commit", "-qm", "fixture"], { cwd });
	return cwd;
}

function harness(exitCode = 0, cwd = repository(), onExec?: () => void) {
	const tools = new Map<string, Tool>();
	const entries: unknown[] = [];
	const executions: Array<{ command: string; args: string[]; cwd?: string }> = [];
	let sessionStart: ((event: unknown, ctx: unknown) => void | Promise<void>) | undefined;
	const pi = {
		registerTool(tool: Tool) { tools.set(tool.name, tool); },
		appendEntry(_kind: string, data: unknown) { entries.push(data); },
		on(event: string, handler: (event: unknown, ctx: unknown) => void | Promise<void>) {
			if (event === "session_start") sessionStart = handler;
		},
		exec: async (command: string, args: string[], options: { cwd?: string }) => {
			executions.push({ command, args, cwd: options.cwd });
			onExec?.();
			return { code: exitCode, stdout: exitCode ? "test failed" : "test passed", stderr: "", killed: false };
		},
	} as unknown as ExtensionAPI;
	createAuditLoopExtension()(pi);
	const call = (name: string, params: Record<string, unknown> = {}) => tools.get(name)!.execute("id", params, new AbortController().signal, undefined, { cwd });
	const resume = async (states: unknown[]) => {
		await sessionStart?.({ type: "session_start", reason: "resume" }, {
			sessionManager: { getBranch: () => states.map((data) => ({ type: "custom", customType: "audit_loop_state", data })) },
		});
	};
	const edit = (file: string, contents = "changed\n") => {
		const path = join(cwd, file);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, contents);
	};
	return { tools, entries, executions, call, resume, cwd, edit };
}

const message = (result: ToolResult) => result.content[0]?.text ?? "";

describe("pi audit tools", () => {
	it("restores an active audit from the current session branch", async () => {
		const first = harness();
		await first.call("audit_loop_start", { scope: "parser bug", test_command: "npm test" });
		await first.call("audit_review", { verdict: "changes_requested", findings: 1, route: "fix", basis: "parser.ts: empty input crashes; reproduced." });
		const second = harness(0, first.cwd);
		await second.resume(first.entries);
		const active = await second.call("audit_loop_status");
		expect(message(active)).toContain("phase=change");
		expect(message(active)).toContain("initial_basis=parser.ts: empty input crashes; reproduced.");
		second.edit("parser.ts");
		second.edit("parser.test.ts");
		await second.call("audit_change", { kind: "fix" });
		await second.call("audit_verify");
		await second.call("audit_review", { verdict: "clean", findings: 0, basis: "Changed guard and regression test match expected behavior." });
		const third = harness(0, first.cwd);
		await third.resume([...first.entries, ...second.entries]);
		expect(message(await third.call("audit_loop_status"))).toContain("done_reason=complete");
		expect(message(await third.call("audit_loop_status"))).toContain("final_basis=Changed guard and regression test match expected behavior.");
		await third.resume([]);
		expect(message(await third.call("audit_loop_status"))).toContain("phase=idle");
	});
	it("rejects a missing review basis and journals both review bases", async () => {
		const { call, entries, edit } = harness();
		await call("audit_loop_start", { scope: "parser bug", test_command: "npm test" });
		const missing = await call("audit_review", { verdict: "changes_requested", findings: 1, route: "fix" });
		expect(missing.isError).toBe(true);
		await call("audit_review", { verdict: "changes_requested", findings: 1, route: "fix", basis: "parser.ts: empty input crashes; reproduced with parse('')." });
		edit("parser.ts");
		edit("parser.test.ts");
		await call("audit_change", { kind: "fix" });
		await call("audit_verify");
		await call("audit_review", { verdict: "clean", findings: 0, basis: "Diff limits the change to the guard and regression test." });
		expect(entries.at(-1)).toMatchObject({ reviewBasis: {
			initial: "parser.ts: empty input crashes; reproduced with parse('').",
			final: "Diff limits the change to the guard and regression test.",
		} });
	});
	it("loads the six workflow tools through the default factory", () => {
		const tools = new Map<string, Tool>();
		(defaultExtension as (pi: ExtensionAPI) => void)({ registerTool(tool: Tool) { tools.set(tool.name, tool); }, appendEntry() {}, on() {} } as unknown as ExtensionAPI);
		expect([...tools.keys()]).toEqual(["audit_loop_start", "audit_review", "audit_change", "audit_verify", "audit_loop_stop", "audit_loop_status"]);
	});

	it("runs a behavior-fix path and executes the exact configured check", async () => {
		const { call, executions, entries, edit, cwd } = harness();
		await call("audit_loop_start", { scope: "parser bug", test_command: "npm test" });
		await call("audit_review", { verdict: "changes_requested", findings: 1, route: "fix", basis: "parser.ts: empty input crashes; reproduced." });
		edit("parser.ts");
		edit("parser.test.ts");
		const changed = await call("audit_change", { kind: "fix" });
		expect(message(changed)).toContain('changed_files=["parser.test.ts","parser.ts"]');
		const verified = await call("audit_verify");
		expect(message(verified)).toContain("test passed");
		expect(executions).toEqual([{ command: "sh", args: ["-c", "npm test"], cwd }]);
		expect(entries.at(-1)).toMatchObject({ changedFiles: ["parser.test.ts", "parser.ts"], verification: "passed" });
		const final = await call("audit_review", { verdict: "clean", findings: 0, basis: "Changed guard and test match expected behavior." });
		expect(message(final)).toContain("complete");
		expect(entries).toHaveLength(5);
	});

	it("does not complete when the configured check fails", async () => {
		const { call } = harness(1);
		await call("audit_loop_start", { scope: "src/", test_command: "npm test" });
		await call("audit_review", { verdict: "clean", findings: 0, basis: "Reviewed scoped code and found no actionable issue." });
		const result = await call("audit_verify");
		expect(message(result)).toContain("checks_failed");
		const status = await call("audit_loop_status");
		expect(message(status)).toContain("done_reason=checks_failed");
	});

	it("reports an unverified result when no check was configured", async () => {
		const { call, executions } = harness();
		await call("audit_loop_start", { scope: "src/" });
		await call("audit_review", { verdict: "clean", findings: 0, basis: "Reviewed scoped code and found no actionable issue." });
		const result = await call("audit_verify");
		expect(message(result)).toContain("unverified");
		expect(executions).toHaveLength(0);
	});

	it("rejects the wrong route and leaves findings open on a no-op", async () => {
		const { call } = harness();
		await call("audit_loop_start", { scope: "src/" });
		await call("audit_review", { verdict: "changes_requested", findings: 1, route: "simplify", basis: "a.ts: duplicate branches obscure the result; both paths match." });
		const wrong = await call("audit_change", { kind: "fix" });
		expect(wrong.isError).toBe(true);
		const open = await call("audit_change", { kind: "simplify" });
		expect(message(open)).toContain("Findings remain open");
	});

	it("distinguishes an existing edit from the audit's own change", async () => {
		const cwd = repository();
		writeFileSync(join(cwd, "a.ts"), "preexisting\n");
		const { call, edit, entries } = harness(0, cwd);
		await call("audit_loop_start", { scope: "parser", test_command: "npm test" });
		await call("audit_review", { verdict: "changes_requested", findings: 1, route: "fix", basis: "parser.ts needs a guard." });
		edit("parser.ts");
		await call("audit_change", { kind: "fix" });
		expect(entries.at(-1)).toMatchObject({ changedFiles: ["parser.ts"] });
	});

	it("fails verification if the test command changes tracked code", async () => {
		const cwd = repository();
		const { call } = harness(0, cwd, () => writeFileSync(join(cwd, "parser.ts"), "mutated by check\n"));
		await call("audit_loop_start", { scope: "parser", test_command: "npm test" });
		await call("audit_review", { verdict: "clean", findings: 0, basis: "No finding." });
		const result = await call("audit_verify");
		expect(message(result)).toContain("changed the repository");
		expect(message(await call("audit_loop_status"))).toContain("done_reason=checks_failed");
	});

	it("fails verification if the test command leaves an untracked file", async () => {
		const cwd = repository();
		const { call } = harness(0, cwd, () => writeFileSync(join(cwd, "probe.ts"), "temporary\n"));
		await call("audit_loop_start", { scope: "parser", test_command: "npm test" });
		await call("audit_review", { verdict: "clean", findings: 0, basis: "No finding." });
		const result = await call("audit_verify");
		expect(message(result)).toContain("changed the repository");
		expect(message(await call("audit_loop_status"))).toContain("done_reason=checks_failed");
	});

	it("invalidates a passing check if code changes before final review", async () => {
		const { call, edit } = harness();
		await call("audit_loop_start", { scope: "parser", test_command: "npm test" });
		await call("audit_review", { verdict: "changes_requested", findings: 1, route: "fix", basis: "parser.ts needs a guard." });
		edit("parser.ts");
		await call("audit_change", { kind: "fix" });
		await call("audit_verify");
		edit("parser.ts", "changed after verification\n");
		const result = await call("audit_review", { verdict: "clean", findings: 0, basis: "Looks good." });
		expect(message(result)).toContain("Verification is stale");
		expect(message(await call("audit_loop_status"))).toContain("done_reason=checks_failed");
	});

	it("rejects code edits made after audit_change and before verification", async () => {
		const { call, edit, executions } = harness();
		await call("audit_loop_start", { scope: "parser", test_command: "npm test" });
		await call("audit_review", { verdict: "changes_requested", findings: 1, route: "fix", basis: "parser.ts needs a guard." });
		edit("parser.ts");
		await call("audit_change", { kind: "fix" });
		edit("parser.ts", "late edit\n");
		const result = await call("audit_verify");
		expect(message(result)).toContain("changed after audit_change");
		expect(executions).toHaveLength(0);
	});

	it("does not complete a clean review if code changed before verification", async () => {
		const { call, edit, executions } = harness();
		await call("audit_loop_start", { scope: "parser", test_command: "npm test" });
		await call("audit_review", { verdict: "clean", findings: 0, basis: "No finding." });
		edit("parser.ts");
		const result = await call("audit_verify");
		expect(message(result)).toContain("changed after the clean review");
		expect(message(await call("audit_loop_status"))).toContain("done_reason=checks_failed");
		expect(executions).toHaveLength(0);
	});

	it("detects a new edit to a file that was dirty before audit start", async () => {
		const cwd = repository();
		writeFileSync(join(cwd, "parser.ts"), "first edit\n");
		const { call, edit, entries } = harness(0, cwd);
		await call("audit_loop_start", { scope: "parser", test_command: "npm test" });
		await call("audit_review", { verdict: "changes_requested", findings: 1, route: "fix", basis: "parser.ts needs a guard." });
		edit("parser.ts", "second edit\n");
		await call("audit_change", { kind: "fix" });
		expect(entries.at(-1)).toMatchObject({ changedFiles: ["parser.ts"] });
	});

	it("detects a staged change after verification", async () => {
		const { call, edit, cwd } = harness();
		await call("audit_loop_start", { scope: "parser", test_command: "npm test" });
		await call("audit_review", { verdict: "changes_requested", findings: 1, route: "fix", basis: "parser.ts needs a guard." });
		edit("parser.ts");
		await call("audit_change", { kind: "fix" });
		await call("audit_verify");
		execFileSync("git", ["add", "parser.ts"], { cwd });
		const result = await call("audit_review", { verdict: "clean", findings: 0, basis: "Looks good." });
		expect(message(result)).toContain("Verification is stale");
	});

	it("refuses a new audit outside a Git repository", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-audit-no-git-"));
		const { call } = harness(0, cwd);
		const result = await call("audit_loop_start", { scope: "parser", test_command: "npm test" });
		expect(result.isError).toBe(true);
		expect(message(result)).toContain("cannot start without Git repository evidence");
	});
});
