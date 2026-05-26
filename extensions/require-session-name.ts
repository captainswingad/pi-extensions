import { randomUUID } from "node:crypto";
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

async function findSessionByName(name: string, currentSessionFile?: string) {
  const normalizedName = name.trim();
  if (!normalizedName) return undefined;

  const current = currentSessionFile ? resolve(currentSessionFile) : undefined;
  const files = await findSessionFiles(sessionsDir);

  for (const file of files) {
    if (current && resolve(file) === current) continue;

    try {
      const existingName = latestSessionName(await readFile(file, "utf8"));
      if (existingName === normalizedName) return file;
    } catch {
      // Ignore sessions that cannot be read.
    }
  }

  return undefined;
}

async function sessionNameExists(name: string, currentSessionFile?: string) {
  return (await findSessionByName(name, currentSessionFile)) !== undefined;
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
  return randomUUID();
}

async function resumeSession(ctx: unknown, sessionFile: string) {
  const switchSession = (ctx as { switchSession?: (path: string) => Promise<{ cancelled: boolean }> }).switchSession;
  if (!switchSession) return false;

  const result = await switchSession(sessionFile);
  return !result.cancelled;
}

/**
 * Require every new Pi session to have a display name.
 *
 * The extension prompts interactively until the user provides a non-empty name.
 * When a conflict happens, the user can choose a generated UUID name instead of
 * inventing another one.
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
      return;
    }

    let message = existingCurrentName
      ? `Session name "${existingCurrentName}" already exists. Choose a different name.`
      : "Enter a session name.";
    let conflictingName = existingCurrentName;
    let conflictingSessionFile = existingCurrentName
      ? await findSessionByName(existingCurrentName, currentSessionFile)
      : undefined;

    for (;;) {
      let name: string;

      if (conflictingName) {
        const choices = ["Use a random UUID", "Enter another name", "Continue with existing session"];
        const choice = await ctx.ui.select(`Session name "${conflictingName}" already exists.`, choices);

        if (choice === undefined) {
          ctx.shutdown();
          return;
        }

        if (choice === "Use a random UUID") {
          conflictingName = undefined;
          conflictingSessionFile = undefined;
          name = randomSessionName();
        } else if (choice === "Continue with existing session") {
          if (conflictingSessionFile && (await resumeSession(ctx, conflictingSessionFile))) return;
          ctx.ui.notify("This Pi context cannot switch sessions from session_start.", "warning");
          ctx.shutdown();
          return;
        } else {
          conflictingName = undefined;
          conflictingSessionFile = undefined;
          continue;
        }
      } else {
        let input: string | undefined;

        try {
          input = await ctx.ui.input("Name this session", message);
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
        message = "A session name is required.";
        continue;
      }

      const existingSessionFile = await findSessionByName(name, currentSessionFile);
      if (existingSessionFile) {
        const choice = await ctx.ui.select(`Session name "${name}" already exists.`, [
          "Use a random UUID",
          "Enter another name",
          "Continue with existing session",
        ]);

        if (choice === undefined) {
          ctx.shutdown();
          return;
        }

        if (choice === "Use a random UUID") {
          name = randomSessionName();
        } else if (choice === "Continue with existing session") {
          if (await resumeSession(ctx, existingSessionFile)) return;
          ctx.ui.notify("This Pi context cannot switch sessions from session_start.", "warning");
          ctx.shutdown();
          return;
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
