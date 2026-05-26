# Extensions

Detailed documentation for the Pi extensions in this package.

## `require-session-name`

Prompts for a human-readable session name whenever a new Pi session starts without one. If the prompt is unavailable, cancelled, or left blank, the extension assigns a safe fallback name in the form `scratch-<uuid>`.

### Behavior

- Skips `/reload` events so reloading extensions does not rename the current session.
- Leaves already named sessions unchanged.
- Uses Pi's UI input when available.
- Falls back automatically in non-interactive contexts.

## `auto-push-extensions`

Automatically versions extension changes in this repository.

### Behavior

- Watches successful Pi `write` and `edit` tool results for extension files.
- Commits and pushes changes under this package's `extensions/` directory.
- Mirrors changed files from `~/.pi/agent/extensions/` into this package before committing, so global extension edits are still versioned in GitHub.
- Provides `/push-extensions` to manually commit and push pending package changes.

### Limitations

- It tracks changes made through Pi's `write` and `edit` tools. Files changed by arbitrary shell commands can still be pushed with `/push-extensions`.
