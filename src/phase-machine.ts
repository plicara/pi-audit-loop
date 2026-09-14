/**
 * Audit loop phase machine — pure logic, no pi dependencies.
 *
 * The loop is a two-phase state machine with structural enforcement:
 *
 *   idle ──(start)──▶ review ──(clean)─────────────────────────▶ done
 *                        │
 *                        └──(changes requested)──▶ simplify ──▶ review ──▶ ...
 *
 * The harness (see extensions/) never lets the model pick the phase — the
 * machine does. A wrong-phase tool call is rejected with guidance, a
 * "changes requested" verdict with zero findings is inconsistent, and the
 * loop terminates only through one of four gates:
 *
 *   1. review_clean      — a review returned no actionable findings
 *   2. nothing_left      — a simplifification pass changed nothing
 *   3. budget_exhausted  — maxRounds simplify passes were applied
 *   4. stopped           — the loop was stopped manually
 *
 * Monotonicity is deliberate: the machine never silently re-reviews the same
 * state, and every transition is recorded in an event journal for tests and
 * post-hoc audit.
 */

export type Phase = "idle" | "review" | "simplify" | "done";
export type Verdict = "clean" | "changes_requested";

export interface LoopConfig {
	/** Maximum number of simplify passes (rounds) before the loop stops. Default 3. */
	maxRounds: number;
}

export interface LoopEvent {
	/** ISO-8601 timestamp. */
	at: string;
	kind: "start" | "review" | "simplify" | "stop" | "budget";
	/** Phase the machine moved into as a result of this event. */
	phase: Phase;
	detail?: string;
}

export interface LoopState {
	phase: Phase;
	/** Number of simplify passes applied so far. */
	round: number;
	scope?: string;
	startedAt?: string;
	endedAt?: string;
	doneReason?: LoopDoneReason;
	/** Findings count of the most recent review. */
	lastFindings: number;
	/** Files reported as changed by the most recent simplify pass. */
	lastChangedFiles: string[];
	/** The verification command for this loop, when one was given. */
	testCommand?: string;
	/** True when the verification command has run successfully since the last change. */
	testVerified: boolean;
}

export type LoopDoneReason = "review_clean" | "nothing_left" | "budget_exhausted" | "stopped";

export type LoopResult =
	| { ok: true; state: LoopState; message: string }
	| { ok: false; error: string; expectedTool: string; state: LoopState };

const REJECT = (machine: AuditLoopMachine, error: string): LoopResult => ({
	ok: false,
	error,
	expectedTool: machine.expectedTool(),
	state: machine.snapshot(),
});

export class AuditLoopMachine {
	private readonly maxRounds: number;
	private events_: LoopEvent[] = [];
	private state_: LoopState = {
		phase: "idle",
		round: 0,
		lastFindings: 0,
		lastChangedFiles: [],
		testVerified: false,
	};

	constructor(config?: Partial<LoopConfig>) {
		this.maxRounds = Math.max(1, Math.floor(config?.maxRounds ?? 3));
	}

	/** Current phase and counters (copy — callers may not mutate the machine). */
	snapshot(): LoopState {
		return { ...this.state_, lastChangedFiles: [...this.state_.lastChangedFiles] };
	}

	/** Event journal, oldest first. */
	events(): readonly LoopEvent[] {
		return this.events_;
	}

	/** The tool the model is expected to call next, for rejection messages. */
	expectedTool(): string {
		switch (this.state_.phase) {
			case "idle":
			case "done":
				return "audit_loop_start";
			case "review":
				return "audit_review";
			case "simplify":
				return "audit_simplify";
		}
	}

	get isRunning(): boolean {
		return this.state_.phase === "review" || this.state_.phase === "simplify";
	}

	private stamp(): string {
		return new Date().toISOString();
	}

	private push(kind: LoopEvent["kind"], phase: Phase, detail?: string): void {
		this.events_.push({ at: this.stamp(), kind, phase, ...(detail ? { detail } : {}) });
	}

	/** Begin a loop. Allowed from idle or from a completed loop. */
	start(scope: string, testCommand?: string): LoopResult {
		if (this.state_.phase === "review" || this.state_.phase === "simplify") {
			return REJECT(
				this,
				`audit_loop_start refused: a loop is already running (phase=${this.state_.phase}, round=${this.state_.round}). Stop it first.`,
			);
		}
		if (!scope || !scope.trim()) {
			return REJECT(this, "audit_loop_start refused: scope is required (a path, a diff range, or a description of what to audit).");
		}
		const command = testCommand?.trim();
		this.state_ = {
			phase: "review",
			round: 0,
			scope: scope.trim(),
			startedAt: this.stamp(),
			lastFindings: 0,
			lastChangedFiles: [],
			...(command ? { testCommand: command } : {}),
			testVerified: false,
		};
		this.push("start", "review", `scope: ${scope.trim()}`);
		return { ok: true, state: this.snapshot(), message: `Audit loop started on: ${scope.trim()}. Next: audit_review.` };
	}

	/** Record a review verdict. Only legal while phase === review. */
	review(verdict: Verdict, findings: number, reviewedFiles: string[] = []): LoopResult {
		if (this.state_.phase !== "review") {
			return REJECT(this, `audit_review refused: the loop is in phase ${this.state_.phase}, not review.`);
		}
		if (verdict === "changes_requested" && findings < 1) {
			return REJECT(this, "audit_review refused: verdict=changes_requested with 0 findings is self-contradictory. Use verdict=clean with 0 findings.");
		}
		this.state_.lastFindings = Math.max(0, Math.floor(findings));
		// Verification is enforced, not requested: when the loop has a test
		// command, "clean" is refused until that command has actually passed
		// since the last change. The extension observes tool executions and
		// reports the result through recordTestRun().
		if (verdict === "clean" && this.state_.testCommand && !this.state_.testVerified) {
			return REJECT(
				this,
				`audit_review refused: verdict=clean needs a successful run of the loop's test command since the last change. Run it first: ${this.state_.testCommand}`,
			);
		}
		// A review reports files *reviewed*, not changed. Leave lastChangedFiles
		// pointing at the most recent simplify pass, so an untouched tree does
		// not report phantom changes in audit_loop_status.
		if (verdict === "clean") {
			this.state_.phase = "done";
			this.state_.endedAt = this.stamp();
			this.state_.doneReason = "review_clean";
			this.push("review", "done", `verdict: clean (${reviewedFiles.length} file(s) reviewed)`);
			return {
				ok: true,
				state: this.snapshot(),
				message: `Review clean after ${this.state_.round} simplify pass(es). Audit loop complete.`,
			};
		}
		this.state_.phase = "simplify";
		this.push("review", "simplify", `verdict: changes_requested (${this.state_.lastFindings} findings)`);
		return {
			ok: true,
			state: this.snapshot(),
			message: `Review requested changes (${this.state_.lastFindings} findings). Next: audit_simplify — apply behavior-preserving simplifications only; run the tests after each change.`,
		};
	}

	/** Record a simplify pass. Only legal while phase === simplify. */
	simplify(changed: boolean, files: string[] = []): LoopResult {
		if (this.state_.phase !== "simplify") {
			return REJECT(this, `audit_simplify refused: the loop is in phase ${this.state_.phase}, not simplify.`);
		}
		if (!changed && files.length > 0) {
			return REJECT(this, "audit_simplify refused: changed=false but files were listed. A pass that changed nothing must list no files.");
		}
		if (changed && files.length === 0) {
			return REJECT(this, "audit_simplify refused: changed=true but no files were listed. List every file the pass modified.");
		}
		this.state_.lastChangedFiles = [...files];
		if (!changed) {
			this.state_.phase = "done";
			this.state_.endedAt = this.stamp();
			this.state_.doneReason = "nothing_left";
			this.push("simplify", "done", "changed: false");
			return { ok: true, state: this.snapshot(), message: "Simplification pass changed nothing. Audit loop complete." };
		}
		this.state_.round += 1;
		// The pass changed code, so any earlier test run no longer covers it.
		this.state_.testVerified = false;
		if (this.state_.round > this.maxRounds) {
			this.state_.phase = "done";
			this.state_.endedAt = this.stamp();
			this.state_.doneReason = "budget_exhausted";
			this.push("budget", "done", `maxRounds=${this.maxRounds} exceeded`);
			return {
				ok: true,
				state: this.snapshot(),
				message: `Budget exhausted after ${this.maxRounds} simplify passes with findings still open. Audit loop complete (review the remaining findings manually).`,
			};
		}
		this.state_.phase = "review";
		this.push("simplify", "review", `changed: true (${files.length} file(s))`);
		return {
			ok: true,
			state: this.snapshot(),
			message:
				`Simplification applied to ${files.length} file(s) in pass ${this.state_.round}. ` +
				`Verify with the test suite, then call audit_review. ` +
				`Review the diff of those files (e.g. \`git diff -- <files>\`), not just the tests: ` +
				`a green suite does not prove the change preserved behavior.`,
		};
	}

	/**
	 * Record the outcome of the loop's verification command. Called by the
	 * extension when it observes the command run (see the tool execution
	 * handlers), so a clean verdict rests on an observed run rather than on the
	 * model's word.
	 */
	recordTestRun(succeeded: boolean): void {
		this.state_.testVerified = succeeded;
	}

	/** Manual stop from any running phase. */
	stop(reason = "stopped by user"): LoopResult {
		if (!this.isRunning) {
			return REJECT(this, `audit_loop_stop refused: the loop is not running (phase=${this.state_.phase}).`);
		}
		this.state_.phase = "done";
		this.state_.endedAt = this.stamp();
		this.state_.doneReason = "stopped";
		this.push("stop", "done", reason);
		return { ok: true, state: this.snapshot(), message: "Audit loop stopped. Use audit_loop_start to begin a new loop." };
	}
}