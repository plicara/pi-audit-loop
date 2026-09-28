import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export interface RepositorySnapshot {
	root: string;
	head: string;
	files: Record<string, string>;
	indexHash: string;
	fingerprint: string;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
	const { stdout } = await run("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
	return stdout;
}

async function fileHash(path: string): Promise<string> {
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink()) return `${info.mode}:${hash(await readlink(path))}`;
		if (!info.isFile()) throw new Error(`Cannot audit non-file path: ${path}`);
		return `${info.mode}:${hash(await readFile(path))}`;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "deleted";
		throw error;
	}
}

export async function snapshotRepository(cwd: string): Promise<RepositorySnapshot> {
	const root = (await git(cwd, "rev-parse", "--show-toplevel")).trim();
	const head = (await git(root, "rev-parse", "HEAD")).trim();
	const status = await git(root, "--no-optional-locks", "status", "--porcelain=v1", "--no-renames", "--untracked-files=all", "-z");
	const paths = status.split("\0").filter(Boolean).map((entry) => ({ status: entry.slice(0, 2), path: entry.slice(3) }));
	const files = Object.fromEntries(await Promise.all(paths.map(async ({ status, path }) => [path, `${status}:${await fileHash(join(root, path))}`] as const)));
	const indexHash = hash(await git(root, "diff", "--cached", "--raw", "-z"));
	const fingerprint = hash(JSON.stringify({ root, head, files: Object.entries(files).sort(), indexHash }));
	return { root, head, files, indexHash, fingerprint };
}

export function changedPaths(before: RepositorySnapshot, after: RepositorySnapshot): string[] {
	if (before.root !== after.root || before.head !== after.head) throw new Error("Repository or HEAD changed during the audit; start a new audit.");
	const paths = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
	const changed = [...paths].filter((path) => before.files[path] !== after.files[path]).sort();
	if (changed.length === 0 && before.indexHash !== after.indexHash) throw new Error("Git index changed without a matching worktree change; start a new audit.");
	return changed;
}
