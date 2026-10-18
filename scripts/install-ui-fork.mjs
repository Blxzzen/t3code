import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as asar from "@electron/asar";

const repo = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
process.chdir(repo);
const mode = process.argv[2] ?? "stage";
NodeAssert.ok(["stage", "install", "restore"].includes(mode), "Use stage, install, or restore.");
const app = NodePath.resolve(process.argv[3] ?? "/Applications/T3 Code (Beta).app");
const resources = (bundle) => NodePath.join(bundle, "Contents/Resources");
const archive = (bundle) => NodePath.join(resources(bundle), "app.asar");
const marker = (bundle) => NodePath.join(resources(bundle), "blxzzen-ui-fork.json");
const run = (command, args, options = {}) =>
  NodeChildProcess.execFileSync(command, args, { encoding: "utf8", ...options });
const readJson = (file) => JSON.parse(NodeFS.readFileSync(file, "utf8"));
const digest = (data) => NodeCrypto.createHash("sha256").update(data).digest("hex");
const previous = NodeFS.existsSync(marker(app)) ? readJson(marker(app)) : null;
const backupRoot = NodePath.join(
  NodeOS.homedir(),
  "Library/Application Support/BlxzzenT3Fork/backups",
);

if (mode === "restore") {
  NodeAssert.ok(
    previous && NodeFS.existsSync(previous.backup),
    "No original app backup was found.",
  );
  run("codesign", ["--verify", "--deep", "--strict", previous.backup]);
  const restored = `${app}.restored`;
  NodeAssert.ok(
    !NodeFS.existsSync(restored),
    `Remove the old staging directory first: ${restored}`,
  );
  run("ditto", [previous.backup, restored]);
  NodeFS.renameSync(app, NodePath.join(backupRoot, `fork-${Date.now()}.app`));
  NodeFS.renameSync(restored, app);
  console.log(`Restored the original app. Relaunch ${app} to activate it.`);
  process.exit(0);
}

const source = previous?.backup ?? app;
NodeAssert.ok(NodeFS.existsSync(archive(source)), `Missing original app: ${source}`);
const pkg = JSON.parse(asar.extractFile(archive(source), "package.json"));
const base = run("git", ["rev-parse", "fork-upstream-base"]).trim();
NodeAssert.ok(
  base.startsWith(pkg.t3codeCommitHash),
  `Installed app is ${pkg.t3codeCommitHash}; rebase the fork onto that commit and update fork-upstream-base first.`,
);
run("git", ["merge-base", "--is-ancestor", base, "HEAD"]);
const backup =
  previous?.backup ?? NodePath.join(backupRoot, `${pkg.version}-${pkg.t3codeCommitHash}.app`);
const clientRoot = "apps/server/dist/client/";
const installedAssets = asar
  .listPackage(archive(source))
  .filter((p) => p.startsWith(`/${clientRoot}assets/`) && p.endsWith(".js"));
const bundle = (prefix) => {
  const files = installedAssets.filter((p) => NodePath.basename(p).startsWith(prefix));
  NodeAssert.ok(files.length, `Missing shipped ${prefix} bundle.`);
  return files
    .map((file) => asar.extractFile(archive(source), file.slice(1)).toString())
    .join("\n");
};
const runtime = bundle("runtime-");
const main = bundle("main-");
const literal = (expression, text = runtime) => {
  const match = text.match(expression);
  NodeAssert.ok(
    match,
    "Shipped public configuration changed; refusing to build with missing connection settings.",
  );
  return match[2];
};
const env = {
  ...process.env,
  APP_VERSION: pkg.version,
  T3CODE_WEB_SOURCEMAP: "0",
  VITE_CLERK_PUBLISHABLE_KEY: literal(/clerkPublishableKey:\w+\((["`])([^"`]+)\1\)/),
  VITE_CLERK_JWT_TEMPLATE: literal(/clerkJwtTemplate:\w+\((["`])([^"`]+)\1\)/),
  VITE_T3CODE_RELAY_URL: literal(/relayUrl:\w+\((["`])([^"`]+)\1\)/),
  VITE_RELAY_OTLP_TRACES_URL: literal(/tracesUrl:\w+\((["`])([^"`]+)\1\)/),
  VITE_RELAY_OTLP_TRACES_DATASET: literal(/tracesDataset:\w+\((["`])([^"`]+)\1\)/),
  VITE_RELAY_OTLP_TRACES_TOKEN: literal(/tracesToken:\w+\((["`])([^"`]+)\1\)/),
  VITE_CLERK_CLI_OAUTH_CLIENT_ID: literal(
    /function \w+\(\)\{return \w+\((["`])([^"`]+)\1\)\}function \w+\(\)\{return!!\(\w+\(\)\.clerkPublishableKey/,
    main,
  ),
  VITE_HTTP_URL: "",
  VITE_WS_URL: "",
};
env.T3CODE_CLERK_PUBLISHABLE_KEY = env.VITE_CLERK_PUBLISHABLE_KEY;
env.T3CODE_CLERK_JWT_TEMPLATE = env.VITE_CLERK_JWT_TEMPLATE;
env.T3CODE_CLERK_CLI_OAUTH_CLIENT_ID = env.VITE_CLERK_CLI_OAUTH_CLIENT_ID;
env.T3CODE_RELAY_URL = env.VITE_T3CODE_RELAY_URL;
env.T3CODE_RELAY_CLIENT_OTLP_TRACES_URL = env.VITE_RELAY_OTLP_TRACES_URL;
env.T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET = env.VITE_RELAY_OTLP_TRACES_DATASET;
env.T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN = env.VITE_RELAY_OTLP_TRACES_TOKEN;
run("pnpm", ["--filter", "@t3tools/web", "build"], { env, stdio: "inherit" });

const stage = NodePath.join(repo, "release", NodePath.basename(app));
NodeFS.mkdirSync(NodePath.dirname(stage), { recursive: true });
NodeFS.rmSync(stage, { recursive: true, force: true });
run("ditto", [source, stage]);
const original = NodeFS.readFileSync(archive(source));
const raw = asar.getRawHeader(archive(source));
const header = structuredClone(raw.header);
const originalData = original.subarray(8 + raw.headerSize);
let offset = originalData.length;
const additions = [];

function clientTree(directory) {
  return {
    files: Object.fromEntries(
      NodeFS.readdirSync(directory, { withFileTypes: true }).map((entry) => {
        const file = NodePath.join(directory, entry.name);
        if (entry.isDirectory()) return [entry.name, clientTree(file)];
        NodeAssert.ok(entry.isFile(), `Unexpected client asset: ${file}`);
        const data = NodeFS.readFileSync(file);
        const blockSize = 4 * 1024 * 1024;
        const blocks = [];
        for (let i = 0; i < data.length; i += blockSize)
          blocks.push(digest(data.subarray(i, i + blockSize)));
        if (blocks.length === 0) blocks.push(digest(data));
        const record = {
          size: data.length,
          offset: String(offset),
          integrity: { algorithm: "SHA256", hash: digest(data), blockSize, blocks },
        };
        offset += data.length;
        additions.push(data);
        return [entry.name, record];
      }),
    ),
  };
}

// Keep every original non-UI entry and data byte, including native modules and unpack flags.
header.files.apps.files.server.files.dist.files.client = clientTree(
  NodePath.join(repo, "apps/web/dist"),
);
const json = Buffer.from(JSON.stringify(header));
const packedHeader = Buffer.alloc(8 + Math.ceil(json.length / 4) * 4);
packedHeader.writeUInt32LE(packedHeader.length - 4, 0);
packedHeader.writeUInt32LE(json.length, 4);
json.copy(packedHeader, 8);
const size = Buffer.alloc(8);
size.writeUInt32LE(4, 0);
size.writeUInt32LE(packedHeader.length, 4);
NodeFS.writeFileSync(
  archive(stage),
  Buffer.concat([size, packedHeader, originalData, ...additions]),
);
const staged = asar.getRawHeader(archive(stage));
NodeAssert.deepEqual(staged.header, header);
NodeAssert.ok(
  NodeFS.readFileSync(archive(stage))
    .subarray(8 + staged.headerSize, 8 + staged.headerSize + originalData.length)
    .equals(originalData),
);
for (const file of [
  "package.json",
  "apps/server/dist/bin.mjs",
  "apps/desktop/dist-electron/main.cjs",
]) {
  NodeAssert.ok(
    asar.extractFile(archive(stage), file).equals(asar.extractFile(archive(source), file)),
  );
}
run("plutil", [
  "-replace",
  "ElectronAsarIntegrity",
  "-json",
  JSON.stringify({ "Resources/app.asar": { algorithm: "SHA256", hash: digest(json) } }),
  NodePath.join(stage, "Contents/Info.plist"),
]);
NodeFS.writeFileSync(
  marker(stage),
  JSON.stringify(
    {
      backup,
      upstreamCommit: base,
      forkCommit: run("git", ["rev-parse", "HEAD"]).trim(),
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
// Vendor keychain and associated-domain entitlements require T3 Tools' signing identity.
const entitlements = NodePath.join(repo, "release", "fork-entitlements.plist");
NodeFS.writeFileSync(
  entitlements,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
<key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>
`,
);
run("codesign", [
  "--force",
  "--sign",
  "-",
  "--options",
  "runtime",
  "--entitlements",
  entitlements,
  stage,
]);
run("codesign", ["--verify", "--deep", "--strict", stage]);
const launchEnv = { ...process.env };
delete launchEnv.ELECTRON_RUN_AS_NODE;
const executable = run("plutil", [
  "-extract",
  "CFBundleExecutable",
  "raw",
  "-o",
  "-",
  NodePath.join(stage, "Contents/Info.plist"),
]).trim();
NodeAssert.equal(
  run(NodePath.join(stage, "Contents/MacOS", executable), ["--version"], {
    env: launchEnv,
    timeout: 15_000,
  }).trim(),
  pkg.version,
);
console.log(`Verified UI-only app: ${stage}`);

if (mode === "install") {
  NodeFS.mkdirSync(backupRoot, { recursive: true });
  if (!NodeFS.existsSync(backup)) run("ditto", [source, backup]);
  const replaced = NodePath.join(backupRoot, `replaced-${Date.now()}.app`);
  NodeFS.renameSync(app, replaced);
  try {
    NodeFS.renameSync(stage, app);
  } catch (error) {
    NodeFS.renameSync(replaced, app);
    throw error;
  }
  console.log(
    `Installed: ${app}\nOriginal backup: ${backup}\nRelaunch T3 Code to activate the UI.`,
  );
}
