import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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

function harness(exitCode = 0) {
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
			return { code: exitCode, stdout: exitCode ? "test failed" : "test passed", stderr: "", killed: false };
		},
	} as unknown as ExtensionAPI;
	createAuditLoopExtension()(pi);
	const call = (name: string, params: Record<string, unknown> = {}) => tools.get(name)!.execute("id", params, new AbortController().signal, undefined, { cwd: "/project" });
	const resume = async (states: unknown[]) => {
		await sessionStart?.({ type: "session_start", reason: "resume" }, {
			sessionManager: { getBranch: () => states.map((data) => ({ type: "custom", customType: "audit_loop_state", data })) },
		});
	};
	return { tools, entries, executions, call, resume };
}

const message = (result: ToolResult) => result.content[0]?.text ?? "";

describe("pi audit tools", () => {
	it("restores an active audit from the current session branch", async () => {
		const first = harness();
		await first.call("audit_loop_start", { scope: "parser bug", test_command: "npm test" });
		await first.call("audit_review", { verdict: "changes_requested", findings: 1, route: "fix", basis: "parser.ts: empty input crashes; reproduced." });
		const second = harness();
		await second.resume(first.entries);
		const active = await second.call("audit_loop_status");
		expect(message(active)).toContain("phase=change");
		expect(message(active)).toContain("initial_basis=parser.ts: empty input crashes; reproduced.");
		await second.call("audit_change", { kind: "fix", changed: true, files: ["parser.ts", "parser.test.ts"] });
		await second.call("audit_verify");
		await second.call("audit_review", { verdict: "clean", findings: 0, basis: "Changed guard and regression test match expected behavior." });
		const third = harness();
		await third.resume([...first.entries, ...second.entries]);
		expect(message(await third.call("audit_loop_status"))).toContain("done_reason=complete");
		expect(message(await third.call("audit_loop_status"))).toContain("final_basis=Changed guard and regression test match expected behavior.");
		await third.resume([]);
		expect(message(await third.call("audit_loop_status"))).toContain("phase=idle");
	});
	it("rejects a missing review basis and journals both review bases", async () => {
		const { call, entries } = harness();
		await call("audit_loop_start", { scope: "parser bug", test_command: "npm test" });
		const missing = await call("audit_review", { verdict: "changes_requested", findings: 1, route: "fix" });
		expect(missing.isError).toBe(true);
		await call("audit_review", { verdict: "changes_requested", findings: 1, route: "fix", basis: "parser.ts: empty input crashes; reproduced with parse('')." });
		await call("audit_change", { kind: "fix", changed: true, files: ["parser.ts", "parser.test.ts"] });
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
		const { call, executions, entries } = harness();
		await call("audit_loop_start", { scope: "parser bug", test_command: "npm test" });
		await call("audit_review", { verdict: "changes_requested", findings: 1, route: "fix", basis: "parser.ts: empty input crashes; reproduced." });
		await call("audit_change", { kind: "fix", changed: true, files: ["parser.ts", "parser.test.ts"] });
		const verified = await call("audit_verify");
		expect(message(verified)).toContain("test passed");
		expect(executions).toEqual([{ command: "sh", args: ["-c", "npm test"], cwd: "/project" }]);
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
		const wrong = await call("audit_change", { kind: "fix", changed: true, files: ["a.ts"] });
		expect(wrong.isError).toBe(true);
		const open = await call("audit_change", { kind: "simplify", changed: false });
		expect(message(open)).toContain("Findings remain open");
	});
});
