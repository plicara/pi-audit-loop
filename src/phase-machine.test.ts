import { describe, expect, it } from "vitest";
import { AuditLoopMachine, type LoopResult } from "./phase-machine.ts";

type Ok = Extract<LoopResult, { ok: true }>;
type Bad = Extract<LoopResult, { ok: false }>;

/** Asserts success and narrows the result for property access. */
const assertOk = (r: LoopResult): Ok => {
	expect(r.ok, `expected ok, got: ${JSON.stringify(r).slice(0, 160)}`).toBe(true);
	return r as Ok;
};
/** Asserts failure and narrows the result for property access. */
const assertErr = (r: LoopResult): Bad => {
	expect(r.ok).toBe(false);
	return r as Bad;
};

describe("AuditLoopMachine", () => {
	describe("start", () => {
		it("moves idle → review and records scope", () => {
			const m = new AuditLoopMachine();
			const r = assertOk(m.start("src/"));
			expect(r.state.phase).toBe("review");
			expect(r.state.round).toBe(0);
			expect(r.state.scope).toBe("src/");
			expect(m.expectedTool()).toBe("audit_review");
			expect(r.message).toContain("audit_review");
		});

		it("refuses when already running", () => {
			const m = new AuditLoopMachine();
			m.start("src/");
			const r = assertErr(m.start("tests/"));
			expect(r.error).toContain("already running");
			expect(r.expectedTool).toBe("audit_review");
		});

		it("refuses with an empty scope", () => {
			const m = new AuditLoopMachine();
			assertErr(m.start("   "));
		});
	});

	describe("review", () => {
		it("a clean review ends the loop", () => {
			const m = new AuditLoopMachine();
			m.start("src/");
			const r = assertOk(m.review("clean", 0));
			expect(r.state.phase).toBe("done");
			expect(r.state.doneReason).toBe("review_clean");
			expect(r.message).toContain("complete");
		});

		it("changes_requested moves to the simplify phase", () => {
			const m = new AuditLoopMachine();
			m.start("src/");
			const r = assertOk(m.review("changes_requested", 3, ["src/a.ts"]));
			expect(r.state.phase).toBe("simplify");
			expect(r.state.lastFindings).toBe(3);
			expect(m.expectedTool()).toBe("audit_simplify");
			expect(r.message).toContain("audit_simplify");
		});

		it("rejects changes_requested with zero findings", () => {
			const m = new AuditLoopMachine();
			m.start("src/");
			const r = assertErr(m.review("changes_requested", 0));
			expect(r.error).toContain("self-contradictory");
			expect(r.state.phase).toBe("review");
		});

		it("rejects a review call outside the review phase", () => {
			const m = new AuditLoopMachine();
			const r = assertErr(m.review("clean", 0));
			expect(r.error).toContain("phase idle");
			expect(r.expectedTool).toBe("audit_loop_start");
		});

		it("rejects a review while the loop is in the simplify phase", () => {
			const m = new AuditLoopMachine();
			m.start("src/");
			m.review("changes_requested", 1);
			const r = assertErr(m.review("changes_requested", 1));
			expect(r.error).toContain("phase simplify");
			expect(r.expectedTool).toBe("audit_simplify");
		});

		it("a review does not report its files as changed", () => {
			const m = new AuditLoopMachine();
			m.start("src/");
			const r = assertOk(m.review("clean", 0, ["src/a.ts", "src/b.ts"]));
			expect(r.state.lastChangedFiles).toEqual([]);
		});
	});

	describe("simplify", () => {
		it("a no-op simplify ends the loop", () => {
			const m = new AuditLoopMachine();
			m.start("src/");
			m.review("changes_requested", 2);
			const r = assertOk(m.simplify(false));
			expect(r.state.phase).toBe("done");
			expect(r.state.doneReason).toBe("nothing_left");
			expect(r.message).toContain("complete");
		});

		it("a real simplify returns to review and increments the round", () => {
			const m = new AuditLoopMachine();
			m.start("src/");
			m.review("changes_requested", 2);
			const r = assertOk(m.simplify(true, ["src/a.ts"]));
			expect(r.state.phase).toBe("review");
			expect(r.state.round).toBe(1);
			expect(r.state.lastChangedFiles).toEqual(["src/a.ts"]);
			expect(m.expectedTool()).toBe("audit_review");
			expect(r.message).toContain("audit_review");
			expect(r.message).toContain("diff");
		});

		it("rejects changed=false with files listed", () => {
			const m = new AuditLoopMachine();
			m.start("src/");
			m.review("changes_requested", 1);
			const r = assertErr(m.simplify(false, ["src/a.ts"]));
			expect(r.error).toContain("changed=false");
		});

		it("rejects changed=true with no files listed", () => {
			const m = new AuditLoopMachine();
			m.start("src/");
			m.review("changes_requested", 1);
			const r = assertErr(m.simplify(true, []));
			expect(r.error).toContain("no files were listed");
		});

		it("rejects a simplify call outside the simplify phase", () => {
			const m = new AuditLoopMachine();
			m.start("src/");
			const r = assertErr(m.simplify(false));
			expect(r.error).toContain("phase review");
			expect(r.expectedTool).toBe("audit_review");
		});
	});

	describe("budget", () => {
		it("stops with budget_exhausted after maxRounds simplify passes", () => {
			const m = new AuditLoopMachine({ maxRounds: 2 });
			m.start("src/");
			m.review("changes_requested", 1);
			assertOk(m.simplify(true, ["a.ts"]));
			m.review("changes_requested", 1);
			assertOk(m.simplify(true, ["b.ts"]));
			m.review("changes_requested", 1);
			const r = assertOk(m.simplify(true, ["c.ts"]));
			expect(r.state.phase).toBe("done");
			expect(r.state.doneReason).toBe("budget_exhausted");
			expect(r.state.round).toBeGreaterThanOrEqual(2);
			expect(r.message).toContain("Budget exhausted");
		});

		it("allows a clean review inside the budget", () => {
			const m = new AuditLoopMachine({ maxRounds: 2 });
			m.start("src/");
			m.review("changes_requested", 1);
			m.simplify(true, ["a.ts"]);
			const r = assertOk(m.review("clean", 0));
			expect(r.state.doneReason).toBe("review_clean");
		});
	});

	describe("stop", () => {
		it("stops a running loop", () => {
			const m = new AuditLoopMachine();
			m.start("src/");
			const r = assertOk(m.stop("user cancelled"));
			expect(r.state.phase).toBe("done");
			expect(r.state.doneReason).toBe("stopped");
		});

		it("refuses to stop a loop that is not running", () => {
			const m = new AuditLoopMachine();
			assertErr(m.stop());
		});
	});

	describe("restart and journal", () => {
		it("can start a new loop after completion", () => {
			const m = new AuditLoopMachine();
			m.start("src/");
			m.review("clean", 0);
			const r = assertOk(m.start("tests/"));
			expect(r.state.phase).toBe("review");
			expect(r.state.scope).toBe("tests/");
		});

		it("keeps an ordered event journal", () => {
			const m = new AuditLoopMachine({ maxRounds: 2 });
			m.start("src/");
			m.review("changes_requested", 1);
			m.simplify(true, ["a.ts"]);
			m.review("changes_requested", 2);
			m.simplify(true, ["b.ts"]);
			expect(m.events().map((e) => e.kind)).toEqual(["start", "review", "simplify", "review", "simplify"]);
			expect(m.snapshot().phase).toBe("review");
		});

		it("snapshots are copies, not views", () => {
			const m = new AuditLoopMachine();
			m.start("src/");
			const s1 = m.snapshot();
			s1.phase = "done";
			expect(m.snapshot().phase).toBe("review");
		});
	});

	describe("verification gate", () => {
		it("refuses a clean verdict before the test command has run", () => {
			const m = new AuditLoopMachine();
			m.start("src/", "npm test");
			const r = assertErr(m.review("clean", 0));
			expect(r.error).toContain("test command");
			expect(r.error).toContain("npm test");
		});

		it("refuses a clean verdict when the observed run failed", () => {
			const m = new AuditLoopMachine();
			m.start("src/", "npm test");
			m.recordTestRun(false);
			expect(assertErr(m.review("clean", 0)).error).toContain("test command");
		});

		it("allows a clean verdict once the test command passed", () => {
			const m = new AuditLoopMachine();
			m.start("src/", "npm test");
			m.recordTestRun(true);
			const r = assertOk(m.review("clean", 0));
			expect(r.state.phase).toBe("done");
			expect(r.state.doneReason).toBe("review_clean");
		});

		it("requires a fresh run after a simplify pass changes code", () => {
			const m = new AuditLoopMachine();
			m.start("src/", "npm test");
			m.recordTestRun(true);
			m.review("changes_requested", 1);
			m.simplify(true, ["src/a.ts"]);
			expect(assertErr(m.review("clean", 0)).error).toContain("test command");
			m.recordTestRun(true);
			expect(assertOk(m.review("clean", 0)).state.phase).toBe("done");
		});

		it("does not gate a loop started without a test command", () => {
			const m = new AuditLoopMachine();
			m.start("src/");
			const r = assertOk(m.review("clean", 0));
			expect(r.state.phase).toBe("done");
			expect(r.state.testCommand).toBeUndefined();
		});

		it("forgets a passing run when a new loop starts", () => {
			const m = new AuditLoopMachine();
			m.start("src/", "npm test");
			m.recordTestRun(true);
			m.review("clean", 0);
			m.start("src/", "npm test");
			expect(assertErr(m.review("clean", 0)).error).toContain("test command");
		});
	});
});