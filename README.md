# Pi Extensions

Personal extensions for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent), packaged so they can be installed from GitHub and versioned with git tags.

## Extensions

### `require-session-name`

Prompts for a human-readable session name whenever a new Pi session starts without one. If the prompt is unavailable, cancelled, or left blank, the extension assigns a safe fallback name in the form `scratch-<uuid>`.

Behavior:

- Skips `/reload` events so reloading extensions does not rename the current session.
- Leaves already named sessions unchanged.
- Uses Pi's UI input when available.
- Falls back automatically in non-interactive contexts.

### `auto-push-extensions`

Automatically versions extension changes in this repository.

Behavior:

- Watches successful Pi `write` and `edit` tool results for extension files.
- Commits and pushes changes under this package's `extensions/` directory.
- Mirrors changed files from `~/.pi/agent/extensions/` into this package before committing, so global extension edits are still versioned in GitHub.
- Provides `/push-extensions` to manually commit and push pending package changes.

Limitations:

- It tracks changes made through Pi's `write` and `edit` tools. Files changed by arbitrary shell commands can still be pushed with `/push-extensions`.

## Installation

Install the latest version from GitHub:

```bash
pi install git:github.com/captainswingad/pi-extensions@v0.2.0
```

For active development, install from `main`:

```bash
pi install git:github.com/captainswingad/pi-extensions@main
```

After installing, restart Pi or run `/reload` in an existing Pi session.

## Package layout

```text
.
├── extensions/
│   ├── auto-push-extensions.ts
│   └── require-session-name.ts
├── package.json
└── README.md
```

The `package.json` file declares this repository as a Pi package via the `pi.extensions` manifest entry.

## Development

1. Edit or add files under `extensions/`.
2. Test locally with:

   ```bash
   pi -e ./extensions/require-session-name.ts
   ```

3. Commit changes with a descriptive message.
4. Tag releases (`v0.2.0`, `v0.3.0`, etc.) so installs can pin a stable version.

## Security

Pi extensions run with local system permissions. Review the code before installing or updating.
