import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Build a collision-resistant default name for sessions that the user does not
 * name explicitly. The prefix keeps these sessions easy to find in Pi's session
 * picker while the UUID avoids accidental duplicates.
 */
function fallbackName() {
  return `scratch-${randomUUID()}`;
}

/**
 * Require every new Pi session to have a display name.
 *
 * The extension prompts interactively when Pi has a UI, but remains safe for
 * non-interactive contexts by falling back to an automatically generated name.
 */
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (event, ctx) => {
    // Reloading extensions should preserve the current session name. Likewise,
    // resumed or forked sessions that already have names should not be changed.
    if (event.reason === "reload" || pi.getSessionName()) return;

    let name: string | undefined;

    if (ctx.hasUI) {
      try {
        name = await ctx.ui.input(
          "Name this session",
          "Leave blank or press Esc for scratch-<uuid>",
        );
      } catch {
        // Some UI modes may reject prompts or the user may cancel. In both
        // cases, use the same fallback path as a blank input.
      }
    }

    const finalName = name?.trim() || fallbackName();
    pi.setSessionName(finalName);
    ctx.ui.notify(`Session named: ${finalName}`, "info");
  });
}
