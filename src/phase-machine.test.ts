import { describe, expect, it } from "vitest";
import { AuditLoopMachine, type LoopResult } from "./phase-machine.ts";

const ok = (result: LoopResult) => {
	expect(result.ok).toBe(true);
	return result.state;
};

const rejected = (result: LoopResult) => {
	expect(result.ok).toBe(false);
	return result;
};

describe("one-pass audit graph", () => {
	it("requires and retains the basis of both reviews", () => {
		const audit = new AuditLoopMachine();
		ok(audit.start("parser bug", "npm test"));
		expect(rejected(audit.review("changes_requested", 1, "fix", "  ")).ok).toBe(false);
		const initial = ok(audit.review("changes_requested", 1, "fix", "parser.ts: empty input crashes; reproduced with parse('')."));
		expect(initial.reviewBasis.initial).toBe("parser.ts: empty input crashes; reproduced with parse('').");
		ok(audit.change("fix", true, ["parser.ts", "parser.test.ts"]));
		ok(audit.verify("passed"));
		expect(rejected(audit.finalReview("clean", 0, " ")).ok).toBe(false);
		const final = ok(audit.finalReview("clean", 0, "Diff changes the empty-input guard and adds a failing-then-passing regression."));
		expect(final.reviewBasis).toEqual({
			initial: "parser.ts: empty input crashes; reproduced with parse('').",
			final: "Diff changes the empty-input guard and adds a failing-then-passing regression.",
		});
	});
	it("routes a behavior finding through a fix, verification, and final review", () => {
		const audit = new AuditLoopMachine();
		ok(audit.start("parser bug", "npm test"));
		expect(ok(audit.review("changes_requested", 1, "fix", "parser.ts: empty input crashes; reproduced.")).phase).toBe("change");
		expect(rejected(audit.change("simplify", true, ["parser.ts"])).ok).toBe(false);
		expect(ok(audit.change("fix", true, ["parser.ts", "parser.test.ts"])).phase).toBe("verify");
		expect(rejected(audit.finalReview("clean", 0)).ok).toBe(false);
		expect(ok(audit.verify("passed")).phase).toBe("final_review");
		expect(ok(audit.finalReview("clean", 0, "Changed guard and test match the expected behavior.")).doneReason).toBe("complete");
	});

	it("routes a design finding through simplification", () => {
		const audit = new AuditLoopMachine();
		ok(audit.start("src/", "npm test"));
		ok(audit.review("changes_requested", 1, "simplify", "src/a.ts: duplicate branches obscure the result; both paths match."));
		ok(audit.change("simplify", true, ["src/a.ts"]));
		ok(audit.verify("passed"));
		expect(ok(audit.finalReview("clean", 0, "Diff removes duplicate branches without changing results.")).doneReason).toBe("complete");
	});

	it("keeps findings open when no change is made", () => {
		const audit = new AuditLoopMachine();
		ok(audit.start("src/", "npm test"));
		ok(audit.review("changes_requested", 1, "simplify", "src/a.ts: duplicate branches obscure the result; both paths match."));
		expect(ok(audit.change("simplify", false)).doneReason).toBe("open_findings");
	});

	it("does not call a failed or missing check complete", () => {
		for (const [command, verification, reason] of [
			["npm test", "failed", "checks_failed"],
			[undefined, "unverified", "unverified"],
		] as const) {
			const audit = new AuditLoopMachine();
			ok(audit.start("src/", command));
			ok(audit.review("clean", 0, undefined, "Reviewed scoped code and found no actionable issue."));
			expect(ok(audit.verify(verification)).doneReason).toBe(reason);
		}
	});

	it("ends with open findings after a final review requests changes", () => {
		const audit = new AuditLoopMachine();
		ok(audit.start("src/", "npm test"));
		ok(audit.review("changes_requested", 2, "fix", "src/a.ts: malformed input crashes; reproduced."));
		ok(audit.change("fix", true, ["src/a.ts"]));
		ok(audit.verify("passed"));
		expect(ok(audit.finalReview("changes_requested", 1, "src/a.ts: null input still crashes in the changed branch.")).doneReason).toBe("open_findings");
	});

	it("rejects contradictory review and change data", () => {
		const audit = new AuditLoopMachine();
		ok(audit.start("src/", "npm test"));
		expect(rejected(audit.review("clean", 1, undefined, "Reviewed scoped code.")).ok).toBe(false);
		expect(rejected(audit.review("changes_requested", 0, "fix", "src/a.ts: malformed input crashes; reproduced.")).ok).toBe(false);
		ok(audit.review("changes_requested", 1, "fix", "src/a.ts: malformed input crashes; reproduced."));
		expect(rejected(audit.change("fix", true, [])).ok).toBe(false);
	});

	it("a clean initial review goes directly through verification", () => {
		const audit = new AuditLoopMachine();
		ok(audit.start("src/", "npm test"));
		expect(ok(audit.review("clean", 0, undefined, "Reviewed scoped code and found no actionable issue.")).phase).toBe("verify");
		expect(ok(audit.verify("passed")).doneReason).toBe("complete");
	});

	it("resets state for a new run and records each transition", () => {
		const audit = new AuditLoopMachine();
		ok(audit.start("src/", "npm test"));
		ok(audit.review("clean", 0, undefined, "Reviewed scoped code and found no actionable issue."));
		ok(audit.verify("passed"));
		ok(audit.start("other/"));
		expect(audit.snapshot().phase).toBe("review");
		expect(audit.snapshot().verification).toBe("pending");
		expect(audit.snapshot().reviewBasis).toEqual({});
		expect(audit.events().map((event) => event.kind)).toEqual(["start", "review", "verify", "start"]);
	});
});
