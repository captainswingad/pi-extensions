# Pi Extensions

Personal extensions for the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent), packaged so they can be installed from GitHub and versioned with git tags.

## Extensions

This package currently includes:

- `require-session-name`
- `auto-push-extensions`

See [docs/extensions.md](docs/extensions.md) for detailed extension behavior and limitations.

## Installation

Install the latest version from GitHub:

```bash
pi install git:github.com/captainswingad/pi-extensions@v0.2.1
```

For active development, install from `main`:

```bash
pi install git:github.com/captainswingad/pi-extensions@main
```

After installing, restart Pi or run `/reload` in an existing Pi session.

## Package layout

```text
.
├── docs/
│   └── extensions.md
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
