# `require-session-name`

Prompts for a unique, human-readable session name whenever a new Pi session starts without one. If the prompt is unavailable, cancelled, left blank, or the requested name conflicts with another session, the extension assigns a safe fallback name in the form `scratch-<uuid>`.

## Behavior

- Skips `/reload` events so reloading extensions does not rename the current session.
- Leaves already named sessions unchanged when the name is unique.
- Checks existing Pi session files for name conflicts.
- Asks for a different name if the chosen name already belongs to another session.
- Uses Pi's UI input when available.
- Falls back automatically in non-interactive contexts.
