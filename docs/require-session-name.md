# `require-session-name`

Prompts for a human-readable session name whenever a new Pi session starts without one. If the prompt is unavailable, cancelled, or left blank, the extension assigns a safe fallback name in the form `scratch-<uuid>`.

## Behavior

- Skips `/reload` events so reloading extensions does not rename the current session.
- Leaves already named sessions unchanged.
- Uses Pi's UI input when available.
- Falls back automatically in non-interactive contexts.
