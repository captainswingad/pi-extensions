# `require-session-name`

Prompts for a unique, human-readable session name whenever a Pi session starts without one or has a name that conflicts with another session.

## Behavior

- Skips `/reload` events so reloading extensions does not rename the current session.
- Leaves already named sessions unchanged when the name is unique.
- Checks existing Pi session files for name conflicts.
- If the chosen name already belongs to another session, offers to use a generated random name or enter another name.
- Asks again if applying the chosen name fails, instead of letting the extension error end the prompt.
- Requires a non-empty session name; blank prompts reopen the prompt.
- Cancelling the name prompt or conflict picker, including with Ctrl+C, requests Pi shutdown instead of trapping you in the TUI.
- Warns and leaves the session unnamed if no UI is available to prompt for a name.
