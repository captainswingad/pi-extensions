import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const sessionsDir = join(homedir(), ".pi", "agent", "sessions");

/**
 * Build a collision-resistant default name for sessions that the user does not
 * name explicitly. The prefix keeps these sessions easy to find in Pi's session
 * picker while the UUID avoids accidental duplicates.
 */
function fallbackName() {
  return `scratch-${randomUUID()}`;
}

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

async function uniqueFallbackName(currentSessionFile?: string) {
  for (;;) {
    const candidate = fallbackName();
    if (!(await sessionNameExists(candidate, currentSessionFile))) return candidate;
  }
}

/**
 * Require every new Pi session to have a unique display name.
 *
 * The extension prompts interactively when Pi has a UI, but remains safe for
 * non-interactive contexts by falling back to an automatically generated name.
 * If a requested name already belongs to another session, the user is asked to
 * choose a different name.
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

    let name = existingCurrentName;
    let conflict = Boolean(existingCurrentName);

    while (ctx.hasUI) {
      try {
        const prompt = conflict
          ? `Session name "${name}" already exists. Choose a different name.`
          : "Leave blank or press Esc for scratch-<uuid>";

        const input = await ctx.ui.input("Name this session", prompt);
        name = input?.trim() || undefined;
      } catch {
        name = undefined;
      }

      if (!name) break;

      conflict = await sessionNameExists(name, currentSessionFile);
      if (!conflict) break;
    }

    const finalName = name && !(await sessionNameExists(name, currentSessionFile))
      ? name
      : await uniqueFallbackName(currentSessionFile);

    pi.setSessionName(finalName);
    ctx.ui.notify(`Session named: ${finalName}`, "info");
  });
}
