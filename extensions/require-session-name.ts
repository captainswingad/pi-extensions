import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const sessionsDir = join(homedir(), ".pi", "agent", "sessions");
const enterNameChoice = "Enter another name";
const resumeSessionChoice = "Resume existing session";

type ConflictChoice = typeof enterNameChoice | typeof resumeSessionChoice;
type SwitchableContext = ExtensionContext & {
  switchSession?: (sessionPath: string) => Promise<{ cancelled: boolean }>;
};

type NamePromptResult =
  | { action: "set"; name: string }
  | { action: "retry"; message?: string }
  | { action: "done" }
  | { action: "cancel" };

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

async function currentNameIsUsable(name: string | undefined, currentSessionFile?: string) {
  return Boolean(name && !(await sessionNameExists(name, currentSessionFile)));
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

function conflictChoices() {
  return [enterNameChoice, resumeSessionChoice] satisfies ConflictChoice[];
}

async function promptForName(ctx: ExtensionContext, message: string) {
  try {
    return (await ctx.ui.input("Name this session", message))?.trim();
  } catch {
    return undefined;
  }
}

async function promptForConflictChoice(ctx: ExtensionContext, name: string) {
  return (await ctx.ui.select(`Session name "${name}" already exists.`, conflictChoices())) as
    | ConflictChoice
    | undefined;
}

async function resumeExistingSession(ctx: ExtensionContext, sessionFile: string) {
  const switchSession = (ctx as SwitchableContext).switchSession;
  if (!switchSession) {
    ctx.ui.notify("Pi cannot resume a session from this extension event.", "warning");
    return false;
  }

  const result = await switchSession.call(ctx, sessionFile);
  if (result.cancelled) {
    ctx.ui.notify("Session switch was cancelled.", "warning");
    return false;
  }

  return true;
}

async function handleConflict(ctx: ExtensionContext, name: string, sessionFile: string): Promise<NamePromptResult> {
  const choice = await promptForConflictChoice(ctx, name);

  if (choice === undefined) return { action: "cancel" };
  if (choice === resumeSessionChoice) {
    return (await resumeExistingSession(ctx, sessionFile)) ? { action: "done" } : { action: "cancel" };
  }

  return {
    action: "retry",
    message: `Session name "${name}" already exists. Choose a different name.`,
  };
}

async function chooseTypedName(
  ctx: ExtensionContext,
  message: string,
  currentSessionFile?: string,
): Promise<NamePromptResult> {
  const name = await promptForName(ctx, message);
  if (name === undefined) return { action: "retry", message: "A session name is required." };
  if (!name) return { action: "retry", message: "A session name is required." };

  const existingSessionFile = await findSessionByName(name, currentSessionFile);
  if (existingSessionFile) return handleConflict(ctx, name, existingSessionFile);

  return { action: "set", name };
}

async function chooseSessionName(
  ctx: ExtensionContext,
  initialMessage: string,
  currentSessionFile?: string,
  initialConflict?: { name: string; sessionFile: string },
) {
  let message = initialMessage;
  let conflict = initialConflict;

  for (;;) {
    const result = conflict
      ? await handleConflict(ctx, conflict.name, conflict.sessionFile)
      : await chooseTypedName(ctx, message, currentSessionFile);

    conflict = undefined;

    if (result.action === "set" || result.action === "done" || result.action === "cancel") return result;
    message = result.message ?? message;
  }
}

async function nameSession(pi: ExtensionAPI, ctx: ExtensionContext) {
  const currentSessionFile = ctx.sessionManager.getSessionFile();
  const existingCurrentName = pi.getSessionName()?.trim();

  if (await currentNameIsUsable(existingCurrentName, currentSessionFile)) return;
  if (!ctx.hasUI) return;

  const initialConflictFile = existingCurrentName
    ? await findSessionByName(existingCurrentName, currentSessionFile)
    : undefined;
  const initialMessage = existingCurrentName
    ? `Session name "${existingCurrentName}" already exists. Choose a different name.`
    : "Enter a session name.";

  const result = await chooseSessionName(
    ctx,
    initialMessage,
    currentSessionFile,
    existingCurrentName && initialConflictFile
      ? { name: existingCurrentName, sessionFile: initialConflictFile }
      : undefined,
  );

  if (result.action === "done") return;
  if (result.action === "cancel") {
    ctx.shutdown();
    return;
  }

  const applied = trySetSessionName(pi, result.name);
  if (!applied.success) {
    ctx.ui.notify(`Could not name this session "${result.name}": ${applied.error}`, "warning");
    await nameSession(pi, ctx);
    return;
  }

  ctx.ui.notify(`Session named: ${result.name}`, "info");
}

/**
 * Require every new Pi session to have a unique display name.
 *
 * The extension prompts interactively until the user provides a non-empty name
 * that is not already used by another session. When a conflict happens, the user
 * can either enter another name or resume the existing session with that name.
 */
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (event, ctx) => {
    // Reloading extensions should preserve the current session name.
    if (event.reason === "reload") return;
    await nameSession(pi, ctx);
  });
}
