import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const sessionsDir = join(homedir(), ".pi", "agent", "sessions");

async function findSessionFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return findSessionFiles(path);
        return entry.isFile() && entry.name.endsWith(".jsonl") ? [path] : [];
      }),
    );
    return files.flat();
  } catch {
    return [];
  }
}

function latestSessionName(jsonl: string) {
  let name: string | undefined;

  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line) as { type?: string; name?: unknown };
      if (entry.type === "session_info") {
        name = typeof entry.name === "string" ? entry.name.trim() : undefined;
      }
    } catch {
      // Ignore malformed or partially written session lines.
    }
  }

  return name || undefined;
}

async function sessionNameExists(name: string, currentSessionFile?: string) {
  const normalizedName = name.trim();
  if (!normalizedName) return false;

  const current = currentSessionFile ? resolve(currentSessionFile) : undefined;
  const files = await findSessionFiles(sessionsDir);

  for (const file of files) {
    if (current && resolve(file) === current) continue;

    try {
      const existingName = latestSessionName(await readFile(file, "utf8"));
      if (existingName === normalizedName) return true;
    } catch {
      // Ignore sessions that cannot be read.
    }
  }

  return false;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function trySetSessionName(pi: ExtensionAPI, name: string) {
  try {
    pi.setSessionName(name);
  } catch (error) {
    return { success: false as const, error: errorMessage(error) };
  }

  const appliedName = pi.getSessionName()?.trim();
  if (appliedName !== name) {
    return {
      success: false as const,
      error: appliedName ? `Pi applied "${appliedName}" instead.` : "Pi did not apply the session name.",
    };
  }

  return { success: true as const };
}

function randomSessionName() {
  return `session-${randomBytes(4).toString("hex")}`;
}

async function uniqueRandomSessionName(currentSessionFile?: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const name = randomSessionName();
    if (!(await sessionNameExists(name, currentSessionFile))) return name;
  }

  return `session-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
}

/**
 * Require every new Pi session to have a unique display name.
 *
 * The extension prompts interactively until the user provides a non-empty name
 * that is not already used by another session. When a conflict happens, the user
 * can choose a generated random name instead of inventing another one.
 */
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (event, ctx) => {
    // Reloading extensions should preserve the current session name.
    if (event.reason === "reload") return;

    const currentSessionFile = ctx.sessionManager.getSessionFile();
    const existingCurrentName = pi.getSessionName()?.trim();

    if (existingCurrentName && !(await sessionNameExists(existingCurrentName, currentSessionFile))) {
      return;
    }

    if (!ctx.hasUI) {
      ctx.ui.notify("Session needs a unique name, but no UI is available to prompt for one.", "warning");
      return;
    }

    let message = existingCurrentName
      ? `Session name "${existingCurrentName}" already exists. Choose a different name.`
      : "Enter a unique session name.";
    let conflictingName = existingCurrentName;

    for (;;) {
      let name: string;

      if (conflictingName) {
        const choice = await ctx.ui.select(`Session name "${conflictingName}" already exists.`, [
          "Use a random name",
          "Enter another name",
        ]);

        if (choice === undefined) {
          ctx.shutdown();
          return;
        }

        if (choice === "Use a random name") {
          conflictingName = undefined;
          name = await uniqueRandomSessionName(currentSessionFile);
        } else {
          conflictingName = undefined;
          continue;
        }
      } else {
        let input: string | undefined;

        try {
          input = await ctx.ui.input(`Name this session\n${message}`);
        } catch {
          input = undefined;
        }

        if (input === undefined) {
          ctx.shutdown();
          return;
        }

        name = input.trim();
      }

      if (!name) {
        message = "A session name is required. Enter a unique session name.";
        ctx.ui.notify(message, "warning");
        continue;
      }

      if (await sessionNameExists(name, currentSessionFile)) {
        const choice = await ctx.ui.select(`Session name "${name}" already exists.`, [
          "Use a random name",
          "Enter another name",
        ]);

        if (choice === undefined) {
          ctx.shutdown();
          return;
        }

        if (choice === "Use a random name") {
          name = await uniqueRandomSessionName(currentSessionFile);
        } else {
          message = `Session name "${name}" already exists. Choose a different name.`;
          continue;
        }
      }

      const result = trySetSessionName(pi, name);
      if (!result.success) {
        message = `Could not name this session "${name}": ${result.error}. Choose a different name.`;
        continue;
      }

      ctx.ui.notify(`Session named: ${name}`, "info");
      return;
    }
  });
}
