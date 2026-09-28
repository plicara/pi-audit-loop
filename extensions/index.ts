import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { AuditLoopMachine, type ChangeKind, type LoopResult, type LoopState, type Verdict } from "../src/phase-machine.ts";

export interface AuditLoopExtensionOptions {
	machine?: AuditLoopMachine;
	onStateChange?: (state: LoopState) => void;
}

type AuditToolResult = AgentToolResult<undefined> & { isError?: boolean };

const text = (message: string): AuditToolResult => ({ content: [{ type: "text", text: message }], details: undefined });

const STATE_ENTRY_TYPE = "audit_loop_state";

export function createAuditLoopExtension(options: AuditLoopExtensionOptions = {}): ExtensionFactory {
	const machine = options.machine ?? new AuditLoopMachine();

	return (pi: ExtensionAPI) => {
		const commit = (result: LoopResult): AuditToolResult => {
			if (!result.ok) return { ...text(`audit_rejected: ${result.error} Expected next tool: ${result.expectedTool}.`), isError: true };
			try {
				pi.appendEntry(STATE_ENTRY_TYPE, machine.snapshot());
			} catch {
				// The in-memory run remains usable when session journaling is unavailable.
			}
			options.onStateChange?.(machine.snapshot());
			return text(result.message);
		};

		pi.registerTool({
			name: "audit_loop_start",
			label: "Audit Start",
			description: "Start one bounded audit of a scope. Establish expected behavior and relevant tests before review. Research external facts only when needed. A missing test command yields an unverified outcome.",
			parameters: Type.Object({
				scope: Type.String({ description: "One change or finding to audit." }),
				test_command: Type.Optional(Type.String({ description: "Command to verify this scope, run directly by audit_verify in the project directory." })),
			}),
			async execute(_id, params) {
				return commit(machine.start(params.scope, params.test_command));
			},
		});

		pi.registerTool({
			name: "audit_review",
			label: "Audit Review",
			description: "Record the initial review or final diff review using the code-review skill. Initial findings choose route=fix for behavior defects or route=simplify for behavior-preserving design work. Final review checks the changed diff and tests. A clean verdict needs zero findings.",
			parameters: Type.Object({
				verdict: Type.Enum(["clean", "changes_requested"]),
				findings: Type.Number({ description: "Number of actionable findings." }),
				route: Type.Optional(Type.Enum(["fix", "simplify"])),
			}),
			async execute(_id, params) {
				const verdict = params.verdict as Verdict;
				if (machine.snapshot().phase === "final_review") return commit(machine.finalReview(verdict, params.findings));
				return commit(machine.review(verdict, params.findings, params.route as ChangeKind | undefined));
			},
		});

		pi.registerTool({
			name: "audit_change",
			label: "Audit Change",
			description: "Record the selected change. For a behavior fix, write and observe a failing regression test before editing implementation, then make the smallest fix. For simplification, preserve behavior. changed=false ends the run with open_findings; call audit_loop_status.",
			parameters: Type.Object({
				kind: Type.Enum(["fix", "simplify"]),
				changed: Type.Boolean(),
				files: Type.Optional(Type.Array(Type.String({ description: "Files changed, including tests." }))),
			}),
			async execute(_id, params) {
				return commit(machine.change(params.kind as ChangeKind, params.changed, params.files ?? []));
			},
		});

		pi.registerTool({
			name: "audit_verify",
			label: "Audit Verify",
			description: "Run the configured test command exactly once in the project directory and record its exit status. Without a command, record unverified. Call after the initial clean review or a change.",
			parameters: Type.Object({}),
			async execute(_id, _params, signal, _update, ctx) {
				const state = machine.snapshot();
				if (state.phase !== "verify") return commit(machine.verify("unverified"));
				if (!state.testCommand) return commit(machine.verify("unverified"));
				let run;
				try {
					run = await pi.exec("sh", ["-c", state.testCommand], { cwd: ctx.cwd, signal, timeout: 300_000 });
				} catch (error) {
					const result = commit(machine.verify("failed"));
					const summary = result.content[0]?.type === "text" ? result.content[0].text : "";
					return text(`${summary}\ncommand failed to execute: ${String(error)}`);
				}
				const result = commit(machine.verify(run.code === 0 && !run.killed ? "passed" : "failed"));
				const summary = result.content[0]?.type === "text" ? result.content[0].text : "";
				const output = [run.stdout, run.stderr].filter(Boolean).join("\n").slice(-4000);
				return text([summary, `command: ${state.testCommand}`, `exit_code=${run.code}`, run.killed ? "process killed" : "", output].filter(Boolean).join("\n"));
			},
		});

		pi.registerTool({
			name: "audit_loop_stop",
			label: "Audit Stop",
			description: "Stop a running audit with an explicit stopped outcome.",
			parameters: Type.Object({ reason: Type.Optional(Type.String()) }),
			async execute(_id, params) {
				return commit(machine.stop(params.reason));
			},
		});

		pi.registerTool({
			name: "audit_loop_status",
			label: "Audit Status",
			description: "Show the current phase, findings, verification, outcome, and expected next tool.",
			parameters: Type.Object({}),
			async execute() {
				const state = machine.snapshot();
				return text([
					`audit_loop_status: phase=${state.phase} scope=${state.scope ?? "—"}`,
					state.doneReason ? `done_reason=${state.doneReason}` : `next_tool=${machine.expectedTool()}`,
					`findings=${state.findings} verification=${state.verification} changed=${state.changedFiles.length} file(s)`,
				].join("\n"));
			},
		});
	};
}

export { AuditLoopMachine };
export type { LoopResult, LoopState } from "../src/phase-machine.ts";
export default createAuditLoopExtension();
