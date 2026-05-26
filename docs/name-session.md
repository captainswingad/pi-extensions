# `name-session`

Prompts for a unique, human-readable session name whenever a Pi session starts without one or has a name that conflicts with another session.

## Behavior

- Skips `/reload` events so reloading extensions does not rename the current session.
- Leaves already named sessions unchanged when the name is unique.
- Checks existing Pi session files for name conflicts.
- Requires a non-empty session name; blank or cancelled prompts reopen the prompt.
- Does not assign automatic fallback names like `scratch-<uuid>`.
- When a typed name already exists, offers two choices:
  - enter another name
  - resume the existing session with that name
- The resume choice switches directly to the existing session; it does not create or queue a helper slash command.
