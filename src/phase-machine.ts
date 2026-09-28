export type Phase = "idle" | "review" | "change" | "verify" | "final_review" | "done";
export type Verdict = "clean" | "changes_requested";
export type ChangeKind = "fix" | "simplify";
export type Verification = "pending" | "passed" | "failed" | "unverified";
export type LoopDoneReason = "complete" | "open_findings" | "checks_failed" | "unverified" | "stopped";

export interface LoopEvent {
	at: string;
	kind: "start" | "review" | "change" | "verify" | "stop";
	phase: Phase;
	detail?: string;
}

export interface LoopState {
	phase: Phase;
	scope?: string;
	testCommand?: string;
	startedAt?: string;
	endedAt?: string;
	doneReason?: LoopDoneReason;
	findings: number;
	reviewBasis: { initial?: string; final?: string };
	changeKind?: ChangeKind;
	changedFiles: string[];
	verification: Verification;
}

export type LoopResult =
	| { ok: true; state: LoopState; message: string }
	| { ok: false; state: LoopState; error: string; expectedTool: string };

export class AuditLoopMachine {
	private state_: LoopState = { phase: "idle", findings: 0, reviewBasis: {}, changedFiles: [], verification: "pending" };
	private events_: LoopEvent[] = [];

	restore(saved: unknown): boolean {
		if (saved === undefined) {
			this.state_ = { phase: "idle", findings: 0, reviewBasis: {}, changedFiles: [], verification: "pending" };
			this.events_ = [];
			return true;
		}
		if (!saved || typeof saved !== "object") return false;
		const state = saved as LoopState;
		if (!["idle", "review", "change", "verify", "final_review", "done"].includes(state.phase)
			|| !Number.isInteger(state.findings)
			|| !Array.isArray(state.changedFiles)
			|| !["pending", "passed", "failed", "unverified"].includes(state.verification)) return false;
		this.state_ = {
			...state,
			reviewBasis: state.reviewBasis && typeof state.reviewBasis === "object" ? { ...state.reviewBasis } : {},
			changedFiles: [...state.changedFiles],
		};
		this.events_ = [];
		return true;
	}

	snapshot(): LoopState {
		return { ...this.state_, reviewBasis: { ...this.state_.reviewBasis }, changedFiles: [...this.state_.changedFiles] };
	}

	events(): readonly LoopEvent[] {
		return this.events_;
	}

	expectedTool(): string {
		switch (this.state_.phase) {
			case "idle":
			case "done":
				return "audit_loop_start";
			case "review":
			case "final_review":
				return "audit_review";
			case "change":
				return "audit_change";
			case "verify":
				return "audit_verify";
		}
	}

	get isRunning(): boolean {
		return this.state_.phase !== "idle" && this.state_.phase !== "done";
	}

	private reject(error: string): LoopResult {
		return { ok: false, state: this.snapshot(), error, expectedTool: this.expectedTool() };
	}

	private transition(kind: LoopEvent["kind"], phase: Phase, message: string, detail?: string): LoopResult {
		this.state_.phase = phase;
		this.events_.push({ at: new Date().toISOString(), kind, phase, ...(detail ? { detail } : {}) });
		return { ok: true, state: this.snapshot(), message };
	}

	private finish(kind: LoopEvent["kind"], reason: LoopDoneReason, message: string): LoopResult {
		this.state_.doneReason = reason;
		this.state_.endedAt = new Date().toISOString();
		return this.transition(kind, "done", message, reason);
	}

	start(scope: string, testCommand?: string): LoopResult {
		if (this.isRunning) return this.reject(`audit_loop_start refused: a run is already in phase ${this.state_.phase}.`);
		if (!scope.trim()) return this.reject("audit_loop_start refused: scope is required.");
		const command = testCommand?.trim();
		this.state_ = {
			phase: "idle",
			scope: scope.trim(),
			...(command ? { testCommand: command } : {}),
			startedAt: new Date().toISOString(),
			findings: 0,
			reviewBasis: {},
			changedFiles: [],
			verification: "pending",
		};
		return this.transition("start", "review", `Audit started on ${this.state_.scope}. Review the scope and call audit_review.`);
	}

	review(verdict: Verdict, findings: number, route?: ChangeKind, basis?: string): LoopResult {
		if (this.state_.phase !== "review") return this.reject(`audit_review refused: phase is ${this.state_.phase}.`);
		if (!Number.isInteger(findings) || findings < 0) return this.reject("audit_review refused: findings must be a nonnegative integer.");
		if (!basis?.trim()) return this.reject("audit_review refused: basis is required.");
		if (verdict === "clean") {
			if (findings !== 0 || route) return this.reject("audit_review refused: a clean review must have zero findings and no route.");
			this.state_.findings = 0;
			this.state_.reviewBasis.initial = basis.trim();
			return this.transition("review", "verify", "No actionable findings. Call audit_verify before completion.");
		}
		if (findings === 0 || !route) return this.reject("audit_review refused: changes_requested needs a positive findings count and a fix or simplify route.");
		this.state_.findings = findings;
		this.state_.reviewBasis.initial = basis.trim();
		this.state_.changeKind = route;
		return this.transition("review", "change", `Review found ${findings} actionable finding(s). Address the selected ${route} finding, then call audit_change.`, route);
	}

	change(kind: ChangeKind, changed: boolean, files: string[] = []): LoopResult {
		if (this.state_.phase !== "change") return this.reject(`audit_change refused: phase is ${this.state_.phase}.`);
		if (kind !== this.state_.changeKind) return this.reject(`audit_change refused: review selected ${this.state_.changeKind}.`);
		if (changed !== (files.length > 0)) return this.reject("audit_change refused: changed and files disagree.");
		if (!changed) return this.finish("change", "open_findings", "No change addressed the finding. Findings remain open; the audit ended. Call audit_loop_status.");
		this.state_.changedFiles = [...files];
		this.state_.verification = "pending";
		return this.transition("change", "verify", "Change recorded. Run audit_verify, then review the resulting diff.", kind);
	}

	verify(result: Exclude<Verification, "pending">): LoopResult {
		if (this.state_.phase !== "verify") return this.reject(`audit_verify refused: phase is ${this.state_.phase}.`);
		if (Boolean(this.state_.testCommand) === (result === "unverified")) {
			return this.reject("audit_verify refused: verification result does not match whether a test command was configured.");
		}
		this.state_.verification = result;
		if (this.state_.changedFiles.length === 0) {
			const reason = result === "passed" ? "complete" : result === "failed" ? "checks_failed" : "unverified";
			return this.finish("verify", reason, `Initial review finished: ${reason}.`);
		}
		return this.transition("verify", "final_review", `Verification ${result}. Review the change diff and tests with audit_review.`, result);
	}

	finalReview(verdict: Verdict, findings: number, basis?: string): LoopResult {
		if (this.state_.phase !== "final_review") return this.reject(`audit_review refused: phase is ${this.state_.phase}.`);
		if (!Number.isInteger(findings) || findings < 0) return this.reject("audit_review refused: findings must be a nonnegative integer.");
		if ((verdict === "clean") !== (findings === 0)) return this.reject("audit_review refused: verdict and findings disagree.");
		if (!basis?.trim()) return this.reject("audit_review refused: basis is required.");
		this.state_.findings = findings;
		this.state_.reviewBasis.final = basis.trim();
		const reason = findings > 0 ? "open_findings" : this.state_.verification === "passed" ? "complete" : this.state_.verification === "failed" ? "checks_failed" : "unverified";
		return this.finish("review", reason, `Final review finished: ${reason}.`);
	}

	stop(reason = "stopped by user"): LoopResult {
		if (!this.isRunning) return this.reject(`audit_loop_stop refused: phase is ${this.state_.phase}.`);
		return this.finish("stop", "stopped", `Audit stopped: ${reason}`);
	}
}
