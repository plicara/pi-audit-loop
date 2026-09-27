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
	it("routes a behavior finding through a fix, verification, and final review", () => {
		const audit = new AuditLoopMachine();
		ok(audit.start("parser bug", "npm test"));
		expect(ok(audit.review("changes_requested", 1, "fix")).phase).toBe("change");
		expect(rejected(audit.change("simplify", true, ["parser.ts"])).ok).toBe(false);
		expect(ok(audit.change("fix", true, ["parser.ts", "parser.test.ts"])).phase).toBe("verify");
		expect(rejected(audit.finalReview("clean", 0)).ok).toBe(false);
		expect(ok(audit.verify("passed")).phase).toBe("final_review");
		expect(ok(audit.finalReview("clean", 0)).doneReason).toBe("complete");
	});

	it("routes a design finding through simplification", () => {
		const audit = new AuditLoopMachine();
		ok(audit.start("src/", "npm test"));
		ok(audit.review("changes_requested", 1, "simplify"));
		ok(audit.change("simplify", true, ["src/a.ts"]));
		ok(audit.verify("passed"));
		expect(ok(audit.finalReview("clean", 0)).doneReason).toBe("complete");
	});

	it("keeps findings open when no change is made", () => {
		const audit = new AuditLoopMachine();
		ok(audit.start("src/", "npm test"));
		ok(audit.review("changes_requested", 1, "simplify"));
		expect(ok(audit.change("simplify", false)).doneReason).toBe("open_findings");
	});

	it("does not call a failed or missing check complete", () => {
		for (const [command, verification, reason] of [
			["npm test", "failed", "checks_failed"],
			[undefined, "unverified", "unverified"],
		] as const) {
			const audit = new AuditLoopMachine();
			ok(audit.start("src/", command));
			ok(audit.review("clean", 0));
			expect(ok(audit.verify(verification)).doneReason).toBe(reason);
		}
	});

	it("ends with open findings after a final review requests changes", () => {
		const audit = new AuditLoopMachine();
		ok(audit.start("src/", "npm test"));
		ok(audit.review("changes_requested", 2, "fix"));
		ok(audit.change("fix", true, ["src/a.ts"]));
		ok(audit.verify("passed"));
		expect(ok(audit.finalReview("changes_requested", 1)).doneReason).toBe("open_findings");
	});

	it("rejects contradictory review and change data", () => {
		const audit = new AuditLoopMachine();
		ok(audit.start("src/", "npm test"));
		expect(rejected(audit.review("clean", 1)).ok).toBe(false);
		expect(rejected(audit.review("changes_requested", 0, "fix")).ok).toBe(false);
		ok(audit.review("changes_requested", 1, "fix"));
		expect(rejected(audit.change("fix", true, [])).ok).toBe(false);
	});

	it("a clean initial review goes directly through verification", () => {
		const audit = new AuditLoopMachine();
		ok(audit.start("src/", "npm test"));
		expect(ok(audit.review("clean", 0)).phase).toBe("verify");
		expect(ok(audit.verify("passed")).doneReason).toBe("complete");
	});

	it("resets state for a new run and records each transition", () => {
		const audit = new AuditLoopMachine();
		ok(audit.start("src/", "npm test"));
		ok(audit.review("clean", 0));
		ok(audit.verify("passed"));
		ok(audit.start("other/"));
		expect(audit.snapshot().phase).toBe("review");
		expect(audit.snapshot().verification).toBe("pending");
		expect(audit.events().map((event) => event.kind)).toEqual(["start", "review", "verify", "start"]);
	});
});
