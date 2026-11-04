# gui-now

CLI for [GUI](https://gui.now) — pipe HTML to get a shareable URL.

## Install

```bash
npm install -g gui-now
```

Or use directly:

```bash
npx gui-now push index.html
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

# Set expiry (capped by plan, see below)
gui push index.html --expires 7d

# Say which agent made the page (shown in your library)
gui push index.html --agent "Claude Code"

# Push an existing page's expiry forward by 24h
gui extend abc123

# Choose a new expiry with the page's edit token (from gui push --json)
gui extend abc123 --token <edit_token> --expires 7d

# Delete a page for good (asks first on a terminal)
gui delete abc123 --token <edit_token>

# Delete from a script or agent
gui delete abc123 --token <edit_token> --yes

# Open an existing canvas
gui open abc123
```

`gui push` prints only the page URL on stdout, so `gui push | pbcopy` works.
The expiry, and for pages made without an account or Pro key a one-time
**claim link**, go to stderr. Open the claim link to sign in and keep the page
in your library. Agents should pass it on to the person they're working for.

## Expiry

`--expires` takes a duration like `30m`, `24h` or `7d`, or `never`. Longer
requests are capped to your plan's limit rather than rejected:

| Who's publishing | Default | Longest |
|------------------|---------|---------|
| No account or key | 24h | 72h |
| Free account | 72h | 7d |
| Pro API key | never | no limit |

`gui extend <id>` without a token adds 24h; a page with no owner can't go
past 72h after it was created. With `--token`, `--expires` sets the new expiry
measured from now, capped the same way.

## Deleting

`gui delete <id>` removes the page for good. It needs the page's edit token
(`--token`), or `GUI_NOW_API_KEY` set to an API key of the account that owns
the page. On a terminal it asks before deleting; from a script or agent it
won't delete unless you pass `--yes`. If the page doesn't exist or the token
or key doesn't match it, you get the same "not found" error either way.

## Options

| Flag | Short | Description |
|------|-------|-------------|
| `--title` | `-t` | Canvas title |
| `--expires` | `-e` | Expiry: a duration like `24h` or `7d`, or `never` |
| `--markdown` | `-m` | Treat input as markdown |
| `--agent` | `-a` | Agent publishing the page, shown in the library |
| `--token` | | Edit token, for `gui extend --expires` and `gui delete` |
| `--yes` | `-y` | Delete without asking |
| `--open` | `-o` | Open URL in browser after creation |
| `--json` | `-j` | Output full JSON response |
| `--help` | `-h` | Show help |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GUI_NOW_API_KEY` | Pro API key for higher rate limits (100/hr vs 5/hr) and longer expiry |
| `GUI_NOW_AGENT` | Default for `--agent` |
| `GUI_NOW_BASE_URL` | API base URL, for a preview or local deploy (default `https://gui.now`) |

## Requirements

Node.js 18+ (uses native `fetch`).

## License

MIT
