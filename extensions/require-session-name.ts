import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const sessionsDir = join(homedir(), ".pi", "agent", "sessions");
const randomNameChoice = "Use a random UUID";
const enterNameChoice = "Enter another name";
const resumeSessionChoice = "Continue with existing session";

type SwitchSession = (path: string) => Promise<{ cancelled: boolean }>;
type MaybeSwitchContext = ExtensionContext & { switchSession?: SwitchSession };
type ConflictChoice = typeof randomNameChoice | typeof enterNameChoice | typeof resumeSessionChoice;
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

function randomSessionName() {
  return randomUUID();
}

function getSwitchSession(ctx: ExtensionContext): SwitchSession | undefined {
  return (ctx as MaybeSwitchContext).switchSession;
}

function conflictChoices(ctx: ExtensionContext) {
  const choices: ConflictChoice[] = [randomNameChoice, enterNameChoice];
  if (getSwitchSession(ctx)) choices.push(resumeSessionChoice);
  return choices;
}

async function resumeSession(ctx: ExtensionContext, sessionFile: string) {
  const switchSession = getSwitchSession(ctx);
  if (!switchSession) return false;

  const result = await switchSession(sessionFile);
  return !result.cancelled;
}

async function promptForName(ctx: ExtensionContext, message: string) {
  try {
    return (await ctx.ui.input("Name this session", message))?.trim();
  } catch {
    return undefined;
  }
}

async function promptForConflictChoice(ctx: ExtensionContext, name: string) {
  return (await ctx.ui.select(`Session name "${name}" already exists.`, conflictChoices(ctx))) as
    | ConflictChoice
    | undefined;
}

async function handleConflict(ctx: ExtensionContext, name: string, sessionFile: string): Promise<NamePromptResult> {
  const choice = await promptForConflictChoice(ctx, name);

  if (choice === undefined) return { action: "cancel" };
  if (choice === randomNameChoice) return { action: "set", name: randomSessionName() };
  if (choice === resumeSessionChoice) {
    if (await resumeSession(ctx, sessionFile)) return { action: "done" };
    ctx.ui.notify("This Pi context cannot switch sessions from session_start.", "warning");
    return { action: "cancel" };
  }

  return {
    action: "retry",
    message: `Session name "${name}" already exists. Choose a different name.`,
  };
}

async function chooseInitialConflictName(
  ctx: ExtensionContext,
  name: string,
  sessionFile: string,
): Promise<NamePromptResult> {
  return handleConflict(ctx, name, sessionFile);
}

async function chooseTypedName(
  ctx: ExtensionContext,
  message: string,
  currentSessionFile?: string,
): Promise<NamePromptResult> {
  const name = await promptForName(ctx, message);
  if (name === undefined) return { action: "cancel" };
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
      ? await chooseInitialConflictName(ctx, conflict.name, conflict.sessionFile)
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
    await nameSession(pi, ctx);
  });
}
