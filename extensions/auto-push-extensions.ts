import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const EXTENSION_FILE_PATTERN = /\.(?:ts|js|mts|mjs|cts|cjs)$/;

/** Repository root for this Pi package. */
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageExtensionsDir = join(packageRoot, "extensions");
const globalExtensionsDir = join(homedir(), ".pi", "agent", "extensions");

function toAbsolutePath(cwd: string, maybePath: unknown) {
  if (typeof maybePath !== "string" || maybePath.length === 0) return undefined;
  const withoutAtPrefix = maybePath.startsWith("@") ? maybePath.slice(1) : maybePath;
  return isAbsolute(withoutAtPrefix) ? withoutAtPrefix : resolve(cwd, withoutAtPrefix);
}

function isInside(parent: string, child: string) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isExtensionPath(path: string) {
  return EXTENSION_FILE_PATTERN.test(path) || path.endsWith("/index.ts") || path.endsWith("/index.js");
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function runGit(args: string[]) {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd: packageRoot,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return `${stdout}${stderr}`.trim();
}

async function currentBranch() {
  const branch = (await runGit(["branch", "--show-current"])).trim();
  return branch || undefined;
}

async function mirrorGlobalExtensionIfNeeded(path: string) {
  if (!isInside(globalExtensionsDir, path) || !isExtensionPath(path) || !existsSync(path)) {
    return false;
  }

  const rel = relative(globalExtensionsDir, path);
  const destination = join(packageExtensionsDir, rel);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(path, destination);
  return true;
}

async function commitAndPush(reason: string) {
  await runGit(["add", "extensions", "README.md", "package.json"]);

  const status = await runGit(["status", "--porcelain"]);
  if (!status) return "No extension changes to push.";

  await runGit(["commit", "-m", `chore: auto-version pi extension changes (${reason})`]);

  // Pi can install git packages at an immutable tag, which leaves the package
  // checkout detached. In that case, push the new commit explicitly to main.
  const branch = await currentBranch();
  await runGit(["push", "origin", branch ?? "HEAD:main"]);
  return "Committed and pushed Pi extension changes.";
}

/**
 * Automatically versions Pi extension edits.
 *
 * When the agent successfully writes or edits a file in this package's
 * `extensions/` directory, the extension commits and pushes the change. If a
 * global extension under `~/.pi/agent/extensions/` is modified, it is mirrored
 * into this package first so GitHub remains the source of versioned history.
 */
export default function (pi: ExtensionAPI) {
  let running = false;
  let rerun = false;
  let lastReason = "extension edit";

  async function schedulePush(reason: string, ctx: { ui: { notify: (message: string, level?: "info" | "warn" | "error" | "success") => void } }) {
    lastReason = reason;
    if (running) {
      rerun = true;
      return;
    }

    running = true;
    try {
      do {
        rerun = false;
        const message = await commitAndPush(lastReason);
        ctx.ui.notify(message, "info");
      } while (rerun);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to auto-push Pi extension changes: ${message}`, "error");
    } finally {
      running = false;
    }
  }

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError || (event.toolName !== "write" && event.toolName !== "edit")) return;

    const changedPath = toAbsolutePath(ctx.cwd, (event.input as { path?: unknown }).path);
    if (!changedPath || !isExtensionPath(changedPath)) return;

    const isPackageExtension = isInside(packageExtensionsDir, changedPath);
    const mirroredGlobalExtension = await mirrorGlobalExtensionIfNeeded(changedPath);

    if (!isPackageExtension && !mirroredGlobalExtension) return;

    const displayPath = isPackageExtension
      ? relative(packageRoot, changedPath)
      : relative(globalExtensionsDir, changedPath);

    await schedulePush(displayPath || "extension edit", ctx);
  });

  pi.registerCommand("push-extensions", {
    description: "Commit and push pending Pi extension package changes",
    handler: async (_args, ctx) => {
      await schedulePush("manual push", ctx);
    },
  });
}
