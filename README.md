# gui-now-cli

CLI for [gui.now](https://gui.now) — pipe HTML to get a shareable URL.

## Install

```bash
npm install -g gui-now-cli
```

Or use directly:

```bash
npx gui-now-cli push index.html
```

## Usage

```bash
# Pipe HTML from stdin
cat index.html | gui push

# Push a file
gui push index.html

# With a title
gui push index.html --title "My Dashboard"

# Push markdown
gui push --markdown README.md

# Open in browser after creation
gui push index.html --open

# Get full JSON response
gui push index.html --json

# Set expiry (Pro)
gui push index.html --expires 7d

# Open an existing canvas
gui open abc123
```

## Options

| Flag | Short | Description |
|------|-------|-------------|
| `--title` | `-t` | Canvas title |
| `--expires` | `-e` | Expiry: `1h`, `24h`, `7d`, `14d`, `30d` |
| `--markdown` | `-m` | Treat input as markdown |
| `--open` | `-o` | Open URL in browser after creation |
| `--json` | `-j` | Output full JSON response |
| `--help` | `-h` | Show help |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GUI_NOW_API_KEY` | Pro API key for higher rate limits (100/hr vs 5/hr) and longer expiry |

## Requirements

Node.js 18+ (uses native `fetch`).

## License

MIT
