/**
 * Every source file in the repo is type-checked by something (issue #246).
 *
 * `tsconfig.json` covers `src`; `tsconfig.node.json` covers the build and test
 * configuration and the docker scripts. Between them they should leave nothing
 * out — but nothing enforces that, and the failure is silent by construction:
 * a file no project includes simply is not checked, and `npm run typecheck`
 * stays green however wrong it is. That is exactly how the duplicate `test:`
 * key in `vite.config.ts` survived a merge.
 *
 * So this asks git for the repo's files, asks TypeScript which files each
 * project actually resolves, and asserts the second set covers the first.
 * Adding a `playwright.config.ts` or a second docker script that nobody checks
 * fails here, at the point it is added, rather than the next time a merge
 * quietly drops half of one.
 *
 * Both halves are asked of the tool that owns the answer rather than worked out
 * here — `git ls-files` for what is in the repo, the compiler's own config
 * parser for what is checked. Every version of this test that guessed at either
 * one was wrong about it.
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

// `import.meta.url`, not `__dirname`: the package is `"type": "module"`, and
// the only reason the CJS name resolved here at all is that vitest's transform
// injects a shim. This file is the repo's statement about what is checked and
// what is not — it should not be the one file that needs a shim to load.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Extensions TypeScript can check. */
const CHECKABLE = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"];

/**
 * The repo's own files, from git rather than from a directory walk.
 *
 * A walk has to be told what to skip, and the list is never finished: it began
 * as node_modules and dist, and the first thing it missed was
 * `.claude/worktrees/`, where this project keeps a full checkout per branch. A
 * walk from the repo root found 226 "uncovered" files there and failed the
 * suite for everyone with a worktree open — while CI, which clones fresh,
 * stayed green. Any ignored scratch file at the root would have done the same.
 *
 * `git ls-files` already knows the answer, and it is the same answer
 * `.gitignore` gives: `--cached` for what is committed, `--others
 * --exclude-standard` for what is new but not ignored — so a `playwright.config.ts`
 * is caught the moment it is written, before it is even staged.
 */
function repoFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter((f) => f && CHECKABLE.some((ext) => f.endsWith(ext)));
}

/**
 * The files a tsconfig actually checks — asked of TypeScript rather than
 * worked out here.
 *
 * This used to strip `//` lines and `JSON.parse` the rest, then match the
 * `include` globs with a small regex of its own. Both halves were guesses at
 * what the compiler does, and the first one broke on config TypeScript is
 * perfectly happy with: a block comment or a trailing comma — both legal jsonc
 * — threw at import time, so a harmless edit to either tsconfig took the whole
 * suite down while `tsc -p` still accepted the file. Reproduced before
 * changing it.
 *
 * `readConfigFile` is the compiler's own jsonc reader and
 * `parseJsonConfigFileContent` its own `include`/`exclude` resolution, so what
 * comes back is the file list `tsc` will really check. That retires the glob
 * matcher along with the parser, and it means a config form nobody here
 * anticipated — `files`, `extends`, a negated `exclude` — is understood for
 * free rather than silently mis-read.
 *
 * Both kinds of error are thrown rather than swallowed: a tsconfig this cannot
 * parse is itself a failure worth reporting, and returning an empty list would
 * make every assertion below fail in a way that named the wrong culprit.
 */
function checkedBy(file: string): string[] {
  const { config, error } = ts.readConfigFile(join(ROOT, file), (p) => readFileSync(p, "utf8"));
  if (error) {
    throw new Error(`${file}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`);
  }
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);
  if (parsed.errors.length) {
    throw new Error(
      `${file}: ` +
        parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("; ")
    );
  }
  return parsed.fileNames.map((f) => relative(ROOT, f).split("\\").join("/"));
}

describe("nothing escapes the type-check", () => {
  const files = repoFiles();
  const app = checkedBy("tsconfig.json");
  const node = checkedBy("tsconfig.node.json");
  const checked = new Set([...app, ...node]);

  it("finds the files it is supposed to be checking", () => {
    // Guards the listing itself: a `git ls-files` that came back empty would
    // make every assertion below vacuously true.
    expect(files).toContain("vite.config.ts");
    expect(files).toContain("docker/prepare.mjs");
    expect(files.some((f) => f.startsWith("src/"))).toBe(true);
  });

  it("does not reach into a nested checkout or anything else git ignores", () => {
    // The failure this replaced: `.claude/worktrees/<branch>/` holds a whole
    // second copy of the repo, and a directory walk counted every file in it.
    expect(files.filter((f) => f.startsWith(".claude/"))).toEqual([]);
    expect(files.filter((f) => f.startsWith("node_modules/"))).toEqual([]);
    expect(files.filter((f) => f.startsWith("dist/"))).toEqual([]);
  });

  it("covers every checkable file with one of the two projects", () => {
    const uncovered = files.filter((f) => !checked.has(f));
    expect(uncovered).toEqual([]);
  });

  it("puts each file in the project that should own it", () => {
    // The coverage test above is satisfied by one project swallowing
    // everything, which would quietly hand `src` the Node globals the split
    // exists to keep away from it. So assert the two are actually distinct,
    // and each one non-empty — a project resolving to nothing would otherwise
    // only show up as a confusing "uncovered" list from the other side.
    expect(app).toContain("src/render.ts");
    expect(app).not.toContain("vite.config.ts");
    expect(node).toContain("vite.config.ts");
    expect(node).toContain("docker/prepare.mjs");
    expect(node).not.toContain("src/render.ts");
  });

  it("types the Node the workflows actually run", () => {
    // `tsconfig.node.json` describes the docker scripts and the build config
    // against whatever major `@types/node` is installed. Pin it to the one CI
    // runs, or the type-check is an opinion about a Node this project does not
    // use: under the 20 typings, `fs/promises.glob` — which exists on CI's
    // Node 24 — is a compile error, so a script could be rejected for using an
    // API that is right there at runtime. The reverse drifts too, and more
    // quietly.
    //
    // Read off the workflows rather than written down twice, so bumping CI's
    // Node is what fails here rather than a comment going stale.
    const workflows = ["validate.yml", "release.yml"]
      .map((f) => readFileSync(join(ROOT, ".github/workflows", f), "utf8"))
      .join("\n");
    const versions = [...workflows.matchAll(/node-version:\s*(\d+)/g)].map((m) => m[1]);
    expect(versions.length).toBeGreaterThan(0);
    expect([...new Set(versions)]).toHaveLength(1); // one answer, or this has no meaning

    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const typesMajor = /(\d+)/.exec(pkg.devDependencies["@types/node"])?.[1];
    expect(typesMajor).toBe(versions[0]);
  });

  it("runs both projects from `npm run typecheck`", () => {
    // Covering a file in a config that no script invokes checks nothing.
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.typecheck).toContain("tsconfig.node.json");
  });
});
