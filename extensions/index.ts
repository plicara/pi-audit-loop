/*
 * pi-audit-loop — alternating code review and behavior-preserving
 * simplification until convergence.
 *
 * The loop is a two-phase state machine that the extension enforces, not the
 * model: a wrong-phase tool call is rejected with guidance, findings and files
 * are cross-checked for consistency, and the loop stops only on a clean
 * review, a no-op simplification pass, an exhausted round budget, or a manual
 * stop. The model's job within each phase follows the bundled skills:
 *
 *   audit_review   -> skills/code-review          (anthropics, vendored)
 *   audit_simplify -> skills/code-simplification  (addyosmani, vendored)
 */
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { AuditLoopMachine, type LoopResult, type LoopState } from "../src/phase-machine.ts";

export interface AuditLoopExtensionOptions {
	/** Maximum number of simplify passes before the loop stops. Default 3. */
	maxRounds?: number;
	/** Injectable machine for tests. */
	machine?: AuditLoopMachine;
	/** Called after every successful state transition. */
	onStateChange?: (state: LoopState) => void;
}

/** AgentToolResult with an isError flag for rejected (wrong-phase) calls. */
type AuditToolResult = AgentToolResult<undefined> & { isError?: boolean };

const text = (message: string): AuditToolResult => ({
	content: [{ type: "text", text: message }],
	details: undefined,
});

const reject = (result: Extract<LoopResult, { ok: false }>): AuditToolResult => ({
	content: [{ type: "text", text: `audit_rejected: ${result.error} Expected next tool: ${result.expectedTool}.` }],
	details: undefined,
	isError: true,
});

const STATE_ENTRY_TYPE = "audit_loop_state";

export function createAuditLoopExtension(options: AuditLoopExtensionOptions = {}): ExtensionFactory {
	const machine = options.machine ?? new AuditLoopMachine({ maxRounds: options.maxRounds ?? 3 });

	return (pi: ExtensionAPI) => {
		const commit = (result: LoopResult): AuditToolResult => {
			if (!result.ok) return reject(result);
			try {
				pi.appendEntry(STATE_ENTRY_TYPE, { ...machine.snapshot() });
			} catch {
				// Entry persistence is best-effort; state still lives in-process.
			}
			if (options.onStateChange) options.onStateChange(machine.snapshot());
			return text(result.message);
		};

		pi.registerTool({
			name: "audit_loop_start",
			label: "Audit Loop Start",
			description:
				"Start an audit loop: alternating code review and behavior-preserving simplification until the review is clean, no further simplifications apply, or the round budget runs out. Follow the code-review and code-simplification skills inside the loop.",
			parameters: Type.Object({
				scope: Type.String({
					description: "What to audit — a path, a diff range (e.g. `main..HEAD`), or a short description of the change under review.",
				}),
				test_command: Type.Optional(
					Type.String({
						description: "Optional command that verifies behavior (e.g. `npm test`). It is your responsibility to run it after every simplification before recording the next review.",
					}),
				),
			}),
			async execute(_toolCallId: string, params, _signal, _onUpdate, ctx) {
				void ctx;
				return commit(machine.start(params.scope));
			},
		});

		pi.registerTool({
			name: "audit_review",
			label: "Audit Review",
			description:
				"Record the result of an audit review (code-review skill). Use verdict=clean only when the review found no actionable findings; use verdict=changes_requested with a positive findings count otherwise. Run the test suite before recording clean.",
			parameters: Type.Object({
				verdict: Type.Enum(["clean", "changes_requested"]),
				findings: Type.Optional(Type.Number({ description: "Number of actionable findings (0 for a clean review)." })),
				files: Type.Optional(Type.Array(Type.String({ description: "Files reviewed." }))),
			}),
			async execute(_toolCallId: string, params, _signal, _onUpdate, ctx) {
				void ctx;
				const verdict = params.verdict as "clean" | "changes_requested";
				return commit(machine.review(verdict, params.findings ?? 0, params.files ?? []));
			},
		});

		pi.registerTool({
			name: "audit_simplify",
			label: "Audit Simplification",
			description:
				"Record one behavior-preserving simplification pass (code-simplification skill). changed=true with the list of modified files, or changed=false if nothing could be simplified. The loop returns to review after every real pass.",
			parameters: Type.Object({
				changed: Type.Boolean(),
				files: Type.Optional(Type.Array(Type.String({ description: "Files modified by this pass. Required when changed=true." }))),
			}),
			async execute(_toolCallId: string, params, _signal, _onUpdate, ctx) {
				void ctx;
				return commit(machine.simplify(params.changed, params.files ?? []));
			},
		});

		pi.registerTool({
			name: "audit_loop_stop",
			label: "Audit Loop Stop",
			description: "Stop the running audit loop early. A stopped loop can be restarted with audit_loop_start.",
			parameters: Type.Object({
				reason: Type.Optional(Type.String({ description: "Why the loop is being stopped." })),
			}),
			async execute(_toolCallId: string, params, _signal, _onUpdate, ctx) {
				void ctx;
				return commit(machine.stop(params.reason ?? "stopped by user"));
			},
		});

		pi.registerTool({
			name: "audit_loop_status",
			label: "Audit Loop Status",
			description: "Show the current audit loop phase, round, and the tool expected next.",
			parameters: Type.Object({}),
			async execute(_toolCallId: string, _params, _signal, _onUpdate, ctx) {
				void ctx;
				const s = machine.snapshot();
				return text(
					[
						`audit_loop_status: phase=${s.phase} round=${s.round} scope=${s.scope ?? "—"}`,
						s.doneReason ? `done_reason=${s.doneReason}` : `next_tool=${machine.expectedTool()}`,
						`events=${machine.events().length} last_findings=${s.lastFindings} last_changed=${s.lastChangedFiles.length} file(s)`,
					].join("\n"),
				);
			},
		});
	};
}

export { AuditLoopMachine };
export type { LoopResult, LoopState } from "../src/phase-machine.ts";

/**
 * Default export must be the extension factory itself: pi invokes the
 * package's default export as factory(pi) at load time.
 */
export default createAuditLoopExtension();