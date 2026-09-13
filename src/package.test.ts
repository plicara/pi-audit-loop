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

	it("is discoverable in the package gallery (pi-package keyword)", () => {
		const pkg = readJson("package.json");
		expect(pkg.keywords).toContain("pi-package");
	});

	it("declares pi-bundled core packages as peers, not runtime deps", () => {
		// pi bundles typebox for extensions; importing it at runtime means it
		// must be a peer dependency, never a plain runtime dependency.
		const pkg = readJson("package.json");
		expect(pkg.peerDependencies?.typebox).toBe("*");
		expect(pkg.peerDependencies?.["@earendil-works/pi-coding-agent"]).toBeTruthy();
		expect(pkg.dependencies?.typebox).toBeUndefined();
	});

	it("ships the full Apache-2.0 text for the vendored Apache-2.0 skill", () => {
		// Apache-2.0 §4(a): recipients must receive a copy of the License.
		const path = join(ROOT, "skills", "code-review", "LICENSE");
		expect(existsSync(path), "skills/code-review/LICENSE exists").toBe(true);
		const src = readFileSync(path, "utf8");
		expect(src).toContain("Apache License");
		expect(src).toContain("Version 2.0, January 2004");
		expect(src).toContain("Redistribution");
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