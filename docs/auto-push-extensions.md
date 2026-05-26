# `auto-push-extensions`

Automatically versions extension changes in this repository.

## Behavior

- Watches successful Pi `write` and `edit` tool results for extension files.
- Commits and pushes changes under this package's `extensions/` directory.
- Adds documentation changes under this package's `docs/` directory to the same commit.
- Mirrors changed files from `~/.pi/agent/extensions/` into this package before committing, so global extension edits are still versioned in GitHub.
- Provides `/push-extensions` to manually commit and push pending package changes.

## Documentation convention

Each extension should have its own Markdown file in `docs/` using the extension file name as the documentation file name:

```text
extensions/<extension_name>.ts -> docs/<extension_name>.md
```

Examples:

- `extensions/require-session-name.ts` -> `docs/require-session-name.md`
- `extensions/auto-push-extensions.ts` -> `docs/auto-push-extensions.md`

## Limitations

- It tracks changes made through Pi's `write` and `edit` tools. Files changed by arbitrary shell commands can still be pushed with `/push-extensions`.
