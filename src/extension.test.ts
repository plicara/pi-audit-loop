import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAuditLoopExtension } from "../extensions/index.ts";
import * as extModule from "../extensions/index.ts";

interface FakeTool {
	name: string;
	description: string;
	parameters: unknown;
	execute: (callId: string, params: Record<string, unknown>, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<ToolOutcome>;
}

interface ToolOutcome {
	content: Array<{ type: string; text: string }>;
	details?: unknown;
	isError?: boolean;
}

function buildHarness(maxRounds?: number) {
	const tools = new Map<string, FakeTool>();
	const entries: Array<{ type: string; data: unknown }> = [];
	const changes: Array<{ phase: string; round: number }> = [];
	const handlers = new Map<string, Array<(event: unknown) => void>>();
	const fakePi = {
		registerTool(tool: FakeTool) {
			tools.set(tool.name, tool);
		},
		appendEntry(type: string, data: unknown) {
			entries.push({ type, data });
		},
		on(event: string, handler: (e: unknown) => void) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
	} as unknown as ExtensionAPI;
	createAuditLoopExtension({ maxRounds, onStateChange: (s) => changes.push({ phase: s.phase, round: s.round }) })(fakePi);
	const call = (name: string, params: Record<string, unknown>): Promise<ToolOutcome> =>
		tools.get(name)!.execute("call_1", params, undefined, undefined, {});
	const emit = (event: string, payload: unknown) => {
		for (const handler of handlers.get(event) ?? []) handler(payload);
	};
	return { tools, entries, changes, call, emit };
}

const resultText = (r: ToolOutcome) => ({ text: r.content?.[0]?.text ?? "", isError: r.isError ?? false });

describe("audit-loop pi extension", () => {
	it("default export is the factory pi invokes at load time", () => {
		// Regression: exporting the cuured creator (createAuditLoopExtension)
		// makes pi call IT as the factory, so nothing registers — silently.
		expect(typeof extModule.default).toBe("function");
		const tools = new Map<string, FakeTool>();
		const fakePi = { registerTool(t: FakeTool) { tools.set(t.name, t); }, appendEntry() {}, on() {} } as unknown as ExtensionAPI;
		(extModule.default as (pi: ExtensionAPI) => void)(fakePi);
		expect(tools.has("audit_loop_start")).toBe(true);
		expect(tools.size).toBe(5);
	});

	it("registers the five tools", () => {
		const { tools } = buildHarness();
		for (const name of [
			"audit_loop_start",
			"audit_review",
			"audit_simplify",
			"audit_loop_stop",
			"audit_loop_status",
		]) {
			expect(tools.has(name), `missing tool ${name}`).toBe(true);
		}
	});

	it("runs a full loop to a clean review", async () => {
		const { call, entries, changes } = buildHarness();
		expect(resultText(await call("audit_loop_start", { scope: "src/" })).text).toContain("Audit loop started");
		expect(resultText(await call("audit_review", { verdict: "changes_requested", findings: 2, files: ["src/a.ts"] })).text).toContain("audit_simplify");
		expect(resultText(await call("audit_simplify", { changed: true, files: ["src/a.ts"] })).text).toContain("audit_review");
		expect(resultText(await call("audit_review", { verdict: "clean", findings: 0, files: ["src/a.ts"] })).text).toContain("complete");
		expect(changes.map((c) => c.phase)).toEqual(["review", "simplify", "review", "done"]);
		expect(changes.map((c) => c.round)).toEqual([0, 0, 1, 1]);
		expect(entries.length).toBe(4);
		expect(entries.every((e) => e.type === "audit_loop_state")).toBe(true);
	});

	it("terminates with nothing_left when simplification is a no-op", async () => {
		const { call } = buildHarness();
		call("audit_loop_start", { scope: "src/" });
		call("audit_review", { verdict: "changes_requested", findings: 1 });
		const r = resultText(await call("audit_simplify", { changed: false }));
		expect(r.text).toContain("complete");
	});

	it("rejects a wrong-phase call with the expected next tool", async () => {
		const { call } = buildHarness();
		call("audit_loop_start", { scope: "src/" });
		const r = resultText(await call("audit_simplify", { changed: false }));
		expect(r.isError).toBe(true);
		expect(r.text).toContain("audit_rejected");
		expect(r.text).toContain("Expected next tool: audit_review");
	});

	it("rejects a self-contradictory review verdict", async () => {
		const { call } = buildHarness();
		call("audit_loop_start", { scope: "src/" });
		const r = resultText(await call("audit_review", { verdict: "changes_requested", findings: 0 }));
		expect(r.isError).toBe(true);
		expect(r.text).toContain("self-contradictory");
	});

	it("stops on budget exhaustion after maxRounds passes", async () => {
		const { call } = buildHarness(1);
		call("audit_loop_start", { scope: "src/" });
		call("audit_review", { verdict: "changes_requested", findings: 1 });
		call("audit_simplify", { changed: true, files: ["a.ts"] });
		call("audit_review", { verdict: "changes_requested", findings: 1 });
		const r = resultText(await call("audit_simplify", { changed: true, files: ["b.ts"] }));
		expect(r.text).toContain("Budget exhausted");
	});

	it("audit_loop_status reports phase and next tool", async () => {
		const { call } = buildHarness();
		call("audit_loop_start", { scope: "src/" });
		const r = resultText(await call("audit_loop_status", {}));
		expect(r.text).toContain("phase=review");
		expect(r.text).toContain("next_tool=audit_review");
	});

	it("blocks a clean verdict until it observes the test command pass", async () => {
		const { call, emit } = buildHarness();
		await call("audit_loop_start", { scope: "src/", test_command: "npm test" });

		const blocked = await call("audit_review", { verdict: "clean", findings: 0 });
		expect(blocked.isError).toBe(true);
		expect(resultText(blocked).text).toContain("npm test");

		emit("tool_execution_start", { toolCallId: "t1", toolName: "bash", args: { command: "cd sub && npm test" } });
		emit("tool_execution_end", { toolCallId: "t1", toolName: "bash", result: {}, isError: false });

		const allowed = await call("audit_review", { verdict: "clean", findings: 0 });
		expect(allowed.isError ?? false).toBe(false);
	});

	it("does not accept a failed run or an unrelated command as verification", async () => {
		const { call, emit } = buildHarness();
		await call("audit_loop_start", { scope: "src/", test_command: "npm test" });

		emit("tool_execution_start", { toolCallId: "t1", toolName: "bash", args: { command: "npm test" } });
		emit("tool_execution_end", { toolCallId: "t1", toolName: "bash", result: {}, isError: true });
		expect((await call("audit_review", { verdict: "clean", findings: 0 })).isError).toBe(true);

		emit("tool_execution_start", { toolCallId: "t2", toolName: "bash", args: { command: "ls -la" } });
		emit("tool_execution_end", { toolCallId: "t2", toolName: "bash", result: {}, isError: false });
		expect((await call("audit_review", { verdict: "clean", findings: 0 })).isError).toBe(true);
	});
});