import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { AuditLoopMachine, type ChangeKind, type LoopResult, type LoopState, type Verdict } from "../src/phase-machine.ts";
import { changedPaths, snapshotRepository } from "../src/repository-evidence.ts";

export interface AuditLoopExtensionOptions {
	machine?: AuditLoopMachine;
	onStateChange?: (state: LoopState) => void;
}

type AuditToolResult = AgentToolResult<undefined> & { isError?: boolean };

const text = (message: string): AuditToolResult => ({ content: [{ type: "text", text: message }], details: undefined });
const errorText = (message: string): AuditToolResult => ({ ...text(`audit_rejected: ${message}`), isError: true });

const STATE_ENTRY_TYPE = "audit_loop_state";

export function createAuditLoopExtension(options: AuditLoopExtensionOptions = {}): ExtensionFactory {
	const machine = options.machine ?? new AuditLoopMachine();

	return (pi: ExtensionAPI) => {
		pi.on("session_start", (_event, ctx) => {
			const branch = ctx.sessionManager.getBranch();
			for (let i = branch.length - 1; i >= 0; i--) {
				const entry = branch[i];
				if (entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE && machine.restore(entry.data)) return;
			}
			machine.restore(undefined);
		});

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
			description: "Start one bounded audit in a Git repository. Establish expected behavior and relevant tests before review. Use a checkout-local test command where possible. Research external facts only when needed. A missing test command yields an unverified outcome.",
			parameters: Type.Object({
				scope: Type.String({ description: "One change or finding to audit." }),
				test_command: Type.Optional(Type.String({ description: "Command run by audit_verify in the project directory; prefer relative executables such as .venv/bin/python so a disposable checkout stays isolated." })),
			}),
			async execute(_id, params, _signal, _update, ctx) {
				if (machine.isRunning) return commit(machine.start(params.scope, params.test_command));
				try {
					return commit(machine.start(params.scope, params.test_command, await snapshotRepository(ctx.cwd)));
				} catch (error) {
					return errorText(`cannot start without Git repository evidence: ${String(error)}`);
				}
			},
		});

		pi.registerTool({
			name: "audit_review",
			label: "Audit Review",
			description: "Record the initial review or final diff review using the code-review skill. Give a concise basis: for a finding, location, claim, and evidence; for a clean verdict, what was reviewed and why it passes. Initial findings choose route=fix or route=simplify; a clean initial review goes straight to audit_verify. Final review checks the changed diff and tests; for simplification, explain a net clarity gain beyond deduplication.",
			parameters: Type.Object({
				verdict: Type.Enum(["clean", "changes_requested"]),
				findings: Type.Number({ description: "Number of actionable findings." }),
				route: Type.Optional(Type.Enum(["fix", "simplify"])),
				basis: Type.String({ description: "Concise review evidence. For a finding: location, claim, and evidence. For a clean review: scope and reason." }),
			}),
			async execute(_id, params, _signal, _update, ctx) {
				const verdict = params.verdict as Verdict;
				const state = machine.snapshot();
				if (state.phase === "final_review") {
					if (state.verification !== "passed") return commit(machine.finalReview(verdict, params.findings, params.basis));
					if (!state.repository || !state.verifiedFingerprint) return commit(machine.invalidateVerification());
					try {
						const current = await snapshotRepository(ctx.cwd);
						if (current.fingerprint !== state.verifiedFingerprint) return commit(machine.invalidateVerification());
					} catch {
						return commit(machine.invalidateVerification());
					}
					return commit(machine.finalReview(verdict, params.findings, params.basis));
				}
				return commit(machine.review(verdict, params.findings, params.route as ChangeKind | undefined, params.basis));
			},
		});

		pi.registerTool({
			name: "audit_change",
			label: "Audit Change",
			description: "Call only after audit_review selects changes_requested and all source, test, and temporary probe edits are finished. Changed files are read from Git against the start snapshot; no change leaves findings open. A later edit invalidates verification. For a behavior fix, observe a failing regression before the smallest code change. For simplification, preserve behavior and require a net clarity gain across the whole diff, beyond fewer lines or a new helper.",
			parameters: Type.Object({
				kind: Type.Enum(["fix", "simplify"]),
			}),
			async execute(_id, params, _signal, _update, ctx) {
				const state = machine.snapshot();
				if (state.phase !== "change") return commit(machine.change(params.kind as ChangeKind, false));
				if (!state.repository) return errorText("this session predates Git evidence; stop and start a new audit.");
				try {
					const current = await snapshotRepository(ctx.cwd);
					const files = changedPaths(state.repository, current);
					const result = commit(machine.change(params.kind as ChangeKind, files.length > 0, files, current.fingerprint));
					if (result.isError || files.length === 0) return result;
					const summary = result.content[0]?.type === "text" ? result.content[0].text : "";
					return text(`${summary}\nchanged_files=${JSON.stringify(files)}`);
				} catch (error) {
					return errorText(String(error));
				}
			},
		});

		pi.registerTool({
			name: "audit_verify",
			label: "Audit Verify",
			description: "Run the configured test command once in the project directory. Record its exit status and reject a check that changes repository files. A final review is bound to the checked revision. Without a command, record unverified.",
			parameters: Type.Object({}),
			async execute(_id, _params, signal, _update, ctx) {
				const state = machine.snapshot();
				if (state.phase !== "verify") return commit(machine.verify("unverified"));
				if (!state.testCommand) return commit(machine.verify("unverified"));
				if (!state.repository) return errorText("this session predates Git evidence; stop and start a new audit.");
				let run;
				let before;
				let after;
				try {
					before = await snapshotRepository(ctx.cwd);
					const expected = state.changedFiles.length > 0 ? state.changeFingerprint : state.repository.fingerprint;
					if (before.fingerprint !== expected) {
						const result = commit(machine.verify("failed", before.fingerprint));
						const summary = result.content[0]?.type === "text" ? result.content[0].text : "";
						return text(`${summary}\nrepository changed after ${state.changedFiles.length > 0 ? "audit_change" : "the clean review"}; verification was not run`);
					}
					run = await pi.exec("sh", ["-c", state.testCommand], { cwd: ctx.cwd, signal, timeout: 300_000 });
					after = await snapshotRepository(ctx.cwd);
				} catch (error) {
					const result = commit(machine.verify("failed"));
					const summary = result.content[0]?.type === "text" ? result.content[0].text : "";
					return text(`${summary}\nverification could not complete: ${String(error)}`);
				}
				const changedByCheck = before.fingerprint !== after.fingerprint;
				const result = commit(machine.verify(run.code === 0 && !run.killed && !changedByCheck ? "passed" : "failed", after.fingerprint, run.code));
				const summary = result.content[0]?.type === "text" ? result.content[0].text : "";
				const output = [run.stdout, run.stderr].filter(Boolean).join("\n").slice(-4000);
				return text([summary, `command: ${state.testCommand}`, `exit_code=${run.code}`, `revision=${after.fingerprint.slice(0, 12)}`, changedByCheck ? "test command changed the repository" : "", run.killed ? "process killed" : "", output].filter(Boolean).join("\n"));
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
					state.verificationExitCode !== undefined ? `check_exit=${state.verificationExitCode}` : "",
					state.verifiedFingerprint ? `checked_revision=${state.verifiedFingerprint.slice(0, 12)}` : "",
					state.reviewBasis.initial ? `initial_basis=${state.reviewBasis.initial}` : "",
					state.reviewBasis.final ? `final_basis=${state.reviewBasis.final}` : "",
				].filter(Boolean).join("\n"));
			},
		});
	};
}

export { AuditLoopMachine };
export type { LoopResult, LoopState } from "../src/phase-machine.ts";
export default createAuditLoopExtension();
