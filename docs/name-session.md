# `name-session`

Prompts for a unique, human-readable session name whenever a Pi session starts without one or has a name that conflicts with another session.

## Behavior

- Skips `/reload` events so reloading extensions does not rename the current session.
- Leaves already named sessions unchanged when the name is unique.
- Checks existing Pi session files for name conflicts.
- Requires a non-empty session name; blank or cancelled prompts reopen the prompt.
- When a typed name already exists, offers two choices:
  - name randomly
  - enter another name
- Random names are UUIDs and are applied without an additional uniqueness check.
- The extension no longer resumes or switches to existing sessions.
