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
	const pi = {
		registerTool(tool: Tool) { tools.set(tool.name, tool); },
		appendEntry(_kind: string, data: unknown) { entries.push(data); },
		exec: async (command: string, args: string[], options: { cwd?: string }) => {
			executions.push({ command, args, cwd: options.cwd });
			return { code: exitCode, stdout: exitCode ? "test failed" : "test passed", stderr: "", killed: false };
		},
	} as unknown as ExtensionAPI;
	createAuditLoopExtension()(pi);
	const call = (name: string, params: Record<string, unknown> = {}) => tools.get(name)!.execute("id", params, new AbortController().signal, undefined, { cwd: "/project" });
	return { tools, entries, executions, call };
}

const message = (result: ToolResult) => result.content[0]?.text ?? "";

describe("pi audit tools", () => {
	it("loads the six workflow tools through the default factory", () => {
		const tools = new Map<string, Tool>();
		(defaultExtension as (pi: ExtensionAPI) => void)({ registerTool(tool: Tool) { tools.set(tool.name, tool); }, appendEntry() {} } as unknown as ExtensionAPI);
		expect([...tools.keys()]).toEqual(["audit_loop_start", "audit_review", "audit_change", "audit_verify", "audit_loop_stop", "audit_loop_status"]);
	});

	it("runs a behavior-fix path and executes the exact configured check", async () => {
		const { call, executions, entries } = harness();
		await call("audit_loop_start", { scope: "parser bug", test_command: "npm test" });
		await call("audit_review", { verdict: "changes_requested", findings: 1, route: "fix" });
		await call("audit_change", { kind: "fix", changed: true, files: ["parser.ts", "parser.test.ts"] });
		const verified = await call("audit_verify");
		expect(message(verified)).toContain("test passed");
		expect(executions).toEqual([{ command: "sh", args: ["-c", "npm test"], cwd: "/project" }]);
		const final = await call("audit_review", { verdict: "clean", findings: 0 });
		expect(message(final)).toContain("complete");
		expect(entries).toHaveLength(5);
	});

	it("does not complete when the configured check fails", async () => {
		const { call } = harness(1);
		await call("audit_loop_start", { scope: "src/", test_command: "npm test" });
		await call("audit_review", { verdict: "clean", findings: 0 });
		const result = await call("audit_verify");
		expect(message(result)).toContain("checks_failed");
		const status = await call("audit_loop_status");
		expect(message(status)).toContain("done_reason=checks_failed");
	});

	it("reports an unverified result when no check was configured", async () => {
		const { call, executions } = harness();
		await call("audit_loop_start", { scope: "src/" });
		await call("audit_review", { verdict: "clean", findings: 0 });
		const result = await call("audit_verify");
		expect(message(result)).toContain("unverified");
		expect(executions).toHaveLength(0);
	});

	it("rejects the wrong route and leaves findings open on a no-op", async () => {
		const { call } = harness();
		await call("audit_loop_start", { scope: "src/" });
		await call("audit_review", { verdict: "changes_requested", findings: 1, route: "simplify" });
		const wrong = await call("audit_change", { kind: "fix", changed: true, files: ["a.ts"] });
		expect(wrong.isError).toBe(true);
		const open = await call("audit_change", { kind: "simplify", changed: false });
		expect(message(open)).toContain("Findings remain open");
	});
});
