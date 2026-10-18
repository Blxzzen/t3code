import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as asar from "@electron/asar";

const repo = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
process.chdir(repo);
const app = NodePath.resolve(process.argv[2] ?? "/Applications/T3 Code (Beta).app");
const run = (command, args, inherit = false) =>
  NodeChildProcess.execFileSync(command, args, {
    encoding: "utf8",
    ...(inherit ? { stdio: "inherit" } : {}),
  });
NodeAssert.equal(
  run("git", ["status", "--porcelain"]).trim(),
  "",
  "Commit or stash local changes before updating.",
);
NodeAssert.equal(
  run("git", ["branch", "--show-current"]).trim(),
  "blxzzen-ui",
  "Switch to blxzzen-ui first.",
);
const pkg = JSON.parse(
  asar.extractFile(NodePath.join(app, "Contents/Resources/app.asar"), "package.json"),
);
const oldBase = run("git", ["rev-parse", "fork-upstream-base"]).trim();
if (!oldBase.startsWith(pkg.t3codeCommitHash)) {
  const newBase = run("gh", [
    "api",
    `repos/pingdotgg/t3code/commits/${pkg.t3codeCommitHash}`,
    "--jq",
    ".sha",
  ]).trim();
  run("git", ["fetch", "--depth=1", "upstream", newBase], true);
  const alreadyRebased =
    NodeChildProcess.spawnSync("git", ["merge-base", "--is-ancestor", newBase, "HEAD"]).status ===
    0;
  if (!alreadyRebased) run("git", ["rebase", "--onto", newBase, oldBase, "blxzzen-ui"], true);
  run("git", ["tag", "-f", "fork-upstream-base", newBase], true);
}
run(
  "pnpm",
  [
    "install",
    "--filter",
    "@t3tools/web...",
    "--filter",
    "@t3tools/scripts...",
    "--filter",
    "@t3tools/oxlint-plugin-t3code...",
    "--frozen-lockfile",
  ],
  true,
);
run(
  "pnpm",
  [
    "exec",
    "vp",
    "test",
    "run",
    "apps/web/src/rightPanelStore.test.ts",
    "apps/web/src/previewMiniPlayerStore.test.ts",
    "apps/web/src/components/chat/chatCanvasLayout.test.ts",
    "apps/web/src/components/chat/ChatCanvas.test.tsx",
    "apps/web/src/components/preview/previewMiniPlayerLayout.test.ts",
  ],
  true,
);
const changed = run("git", [
  "diff",
  "--name-only",
  "fork-upstream-base",
  "--",
  "*.ts",
  "*.tsx",
  "*.mjs",
])
  .trim()
  .split("\n")
  .filter(Boolean);
run("pnpm", ["exec", "vp", "lint", ...changed], true);
run("pnpm", ["--filter", "@t3tools/web", "typecheck"], true);
run(process.execPath, ["scripts/install-ui-fork.mjs", "install", app], true);
