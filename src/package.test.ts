import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function readJson(p: string) {
	return JSON.parse(readFileSync(join(ROOT, p), "utf8"));
}

describe("package integrity", () => {
	it("declares extensions/ and skills/ in the pi manifest", () => {
		const pkg = readJson("package.json");
		expect(pkg.pi.extensions).toContain("extensions/");
		expect(pkg.pi.skills).toContain("skills/");
	});

	it("ships the two vendored skills with valid frontmatter", () => {
		for (const dir of ["code-review", "code-simplification"]) {
			const path = join(ROOT, "skills", dir, "SKILL.md");
			expect(existsSync(path), `${path} exists`).toBe(true);
			const src = readFileSync(path, "utf8");
			expect(src.startsWith("---\n"), `frontmatter opens in ${dir}`).toBe(true);
			const fm = src.split("---\n")[1];
			expect(fm).toContain("name:");
			expect(fm).toContain("description:");
			expect(src).toContain("SOURCES.md");
		}
	});

	it("every file listed in package.json files exists", () => {
		const pkg = readJson("package.json");
		for (const entry of pkg.files) {
			expect(existsSync(join(ROOT, entry)), `missing: ${entry}`).toBe(true);
		}
	});

	it("vendored skills carry pinned attribution footers", () => {
		const review = readFileSync(join(ROOT, "skills", "code-review", "SKILL.md"), "utf8");
		expect(review).toContain("anthropics/knowledge-work-plugins");
		expect(review).toContain("a6d8653");
		const simplify = readFileSync(join(ROOT, "skills", "code-simplification", "SKILL.md"), "utf8");
		expect(simplify).toContain("addyosmani/agent-skills");
		expect(simplify).toContain("be4e44a");
	});

	it("no stray jsonl or credential files are tracked in skills", () => {
		const walk = (p: string): string[] =>
			readdirSync(p, { withFileTypes: true }).flatMap((e) => {
				const full = join(p, e.name);
				return e.isDirectory() ? walk(full) : [full];
			});
		for (const f of walk(join(ROOT, "skills"))) {
			expect(f.endsWith(".jsonl")).toBe(false);
		}
	});
});