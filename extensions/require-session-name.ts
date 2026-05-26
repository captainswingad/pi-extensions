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

/**
 * Require every new Pi session to have a unique display name.
 *
 * The extension prompts interactively until the user provides a non-empty name
 * that is not already used by another session. It intentionally does not assign
 * automatic fallback names; conflicts and blank names must be resolved by the
 * user when a UI is available.
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
      ctx.ui.notify("Session needs a unique name, but no UI is available to prompt for one.", "warn");
      return;
    }

    let message = existingCurrentName
      ? `Session name "${existingCurrentName}" already exists. Choose a different name.`
      : "Enter a unique session name.";

    for (;;) {
      let input: string | undefined;

      try {
        input = await ctx.ui.input("Name this session", message);
      } catch {
        input = undefined;
      }

      const name = input?.trim();

      if (!name) {
        message = "A session name is required. Enter a unique session name.";
        continue;
      }

      if (await sessionNameExists(name, currentSessionFile)) {
        message = `Session name "${name}" already exists. Choose a different name.`;
        continue;
      }

      pi.setSessionName(name);
      ctx.ui.notify(`Session named: ${name}`, "info");
      return;
    }
  });
}
