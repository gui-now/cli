#!/usr/bin/env node

import { readFileSync } from 'fs'
import { execFile } from 'child_process'
import { configFromEnv, createCanvas, extendCanvas, GuiError } from './api.js'

const config = configFromEnv()
const isTTY = process.stdout.isTTY ?? false

// Simple ANSI colors (only when TTY)
const green = (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s)
const red = (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s)
const dim = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s)
const bold = (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s)

function printHelp() {
  console.log(`
${bold('gui')} — pipe HTML to gui.now, get a shareable URL

${bold('USAGE')}
  gui push [file] [options]    Create a canvas
  gui extend <id> [options]    Push a canvas's expiry forward
  gui open <id>                Open a canvas in the browser
  gui help                     Show this help

${bold('EXAMPLES')}
  cat index.html | gui push
  gui push index.html --title "My Dashboard"
  gui push --markdown README.md
  echo "<h1>Hello</h1>" | gui push --open
  gui extend abc123
  gui extend abc123 --token <edit_token> --expires 7d

${bold('OPTIONS')}
  -t, --title <title>     Canvas title
  -e, --expires <dur>     Expiry like 30m, 24h, 7d, or never. Capped by plan:
                          no account 72h, free account 7d, Pro key no limit
  -m, --markdown          Treat input as markdown
  -a, --agent <name>      Agent publishing the page, shown in the library
  -o, --open              Open URL in browser after creation
  -j, --json              Output full JSON response
  -h, --help              Show help

${bold('EXTEND')}
  Without --token, extend adds 24h (pages without an owner stop at 72h after
  creation). With the page's edit token, --expires sets a new expiry from now.
  --token <edit_token>    The edit_token from gui push --json

${bold('ENVIRONMENT')}
  GUI_NOW_API_KEY          Pro API key for higher limits
  GUI_NOW_AGENT            Default for --agent
  GUI_NOW_BASE_URL         API base URL (default https://gui.now)
`)
}

function parseArgs(argv: string[]): {
  command: string
  file?: string
  title?: string
  expires?: string
  agent?: string
  token?: string
  markdown: boolean
  json: boolean
  open: boolean
  help: boolean
  id?: string
} {
  const result = {
    command: '',
    file: undefined as string | undefined,
    title: undefined as string | undefined,
    expires: undefined as string | undefined,
    agent: undefined as string | undefined,
    token: undefined as string | undefined,
    markdown: false,
    json: false,
    open: false,
    help: false,
    id: undefined as string | undefined,
  }

  const args = argv.slice(2)
  let i = 0

  // First positional = command
  if (args.length > 0 && !args[0].startsWith('-')) {
    result.command = args[0]
    i = 1
  }

  while (i < args.length) {
    const arg = args[i]
    switch (arg) {
      case '-t':
      case '--title':
        result.title = args[++i]
        break
      case '-e':
      case '--expires':
        result.expires = args[++i]
        break
      case '-a':
      case '--agent':
        result.agent = args[++i]
        break
      case '--token':
        result.token = args[++i]
        break
      case '-m':
      case '--markdown':
        result.markdown = true
        break
      case '-j':
      case '--json':
        result.json = true
        break
      case '-o':
      case '--open':
        result.open = true
        break
      case '-h':
      case '--help':
        result.help = true
        break
      default:
        // Positional: file or id
        if (!result.file && !result.id && !arg.startsWith('-')) {
          if (result.command === 'open' || result.command === 'extend') {
            result.id = arg
          } else {
            result.file = arg
          }
        }
        break
    }
    i++
  }

  return result
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    // An interactive terminal means nothing is being piped in.
    if (process.stdin.isTTY) {
      resolve('')
      return
    }

    const chunks: Buffer[] = []
    let sawData = false

    // stdin can be an open pipe with no writer, in which case 'end' never
    // fires and we wait forever. A timeout would fix the hang but would also
    // truncate a slow producer, which is worse -- `slow-command | gui push`
    // is legitimate and may take seconds to emit its first byte. So keep
    // waiting, but say so, and only on a terminal where it will not pollute
    // piped output.
    const hint = setTimeout(() => {
      if (!sawData && isTTY) {
        console.error(dim('Waiting for input on stdin... (Ctrl-C to cancel)'))
      }
    }, 2000)
    hint.unref()

    process.stdin.on('data', (chunk) => {
      sawData = true
      clearTimeout(hint)
      chunks.push(chunk)
    })
    process.stdin.on('end', () => {
      clearTimeout(hint)
      resolve(Buffer.concat(chunks).toString('utf-8'))
    })
    process.stdin.on('error', (err) => {
      clearTimeout(hint)
      reject(err)
    })
  })
}

function openUrl(url: string) {
  // execFile, not exec: the URL can carry a canvas id straight from argv, and
  // interpolating that into a shell string lets `gui open '$(...)'` run it.
  if (process.platform === 'darwin') {
    execFile('open', [url])
  } else if (process.platform === 'win32') {
    // `start` is a cmd.exe builtin, so it needs a shell to live in. The empty
    // string is the window title cmd would otherwise take the URL to be.
    execFile('cmd', ['/c', 'start', '', url])
  } else {
    execFile('xdg-open', [url])
  }
}

function formatExpiry(expiresAt: string | null): string {
  return expiresAt === null ? 'never expires' : `expires ${expiresAt}`
}

function fail(err: unknown): never {
  console.error(red(`Error: ${(err as Error).message}`))
  if (err instanceof GuiError && err.maxExpiresAt) {
    console.error(dim(`This page can't be extended past ${err.maxExpiresAt}. Claim it or use a Pro key to keep it longer.`))
  }
  process.exit(1)
}

async function main() {
  const opts = parseArgs(process.argv)

  if (opts.help || (!opts.command && process.argv.length <= 2)) {
    printHelp()
    process.exit(0)
  }

  if (opts.command === 'help') {
    printHelp()
    process.exit(0)
  }

  if (opts.command === 'open') {
    if (!opts.id) {
      console.error(red('Error: gui open requires a canvas ID'))
      process.exit(1)
    }
    const url = `${config.baseUrl}/${encodeURIComponent(opts.id)}`
    openUrl(url)
    console.log(dim(`Opening ${url}`))
    process.exit(0)
  }

  if (opts.command === 'extend') {
    if (!opts.id) {
      console.error(red('Error: gui extend requires a canvas ID'))
      process.exit(1)
    }
    try {
      const data = await extendCanvas(config, opts.id, { token: opts.token, expires: opts.expires })
      if (opts.json) {
        console.log(JSON.stringify(data, null, 2))
      } else {
        console.log(formatExpiry(data.expires_at))
        if (data.expires_clamped) console.error(dim('Capped at the longest expiry this page allows.'))
      }
    } catch (err) {
      fail(err)
    }
    process.exit(0)
  }

  if (opts.command === 'push') {
    let content = ''

    if (opts.file) {
      try {
        content = readFileSync(opts.file, 'utf-8')
      } catch (err) {
        console.error(red(`Error: Cannot read file '${opts.file}'`))
        process.exit(1)
      }
    } else {
      try {
        content = await readStdin()
      } catch (err) {
        console.error(red(`Error: Cannot read stdin — ${(err as Error).message}`))
        process.exit(1)
      }
    }

    if (!content.trim()) {
      console.error(red('Error: No content provided. Pipe HTML or pass a file.'))
      console.error(dim('  cat index.html | gui push'))
      console.error(dim('  gui push index.html'))
      process.exit(1)
    }

    try {
      const data = await createCanvas(config, content, {
        title: opts.title,
        expires: opts.expires,
        markdown: opts.markdown,
        agent: opts.agent || process.env.GUI_NOW_AGENT || undefined,
      })

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2))
      } else {
        // stdout carries only the URL so `gui push | pbcopy` keeps working.
        // Everything else goes to stderr, which agents running the CLI still see.
        console.log(green(data.url))
        console.error(dim(formatExpiry(data.expires_at)))
        if (data.expires_clamped) console.error(dim('Expiry capped at the longest your plan allows.'))
        if (data.claim_url) {
          console.error(`Keep this page: open ${data.claim_url} to sign in and save it to your library. The link works once.`)
        }
      }

      if (opts.open) {
        openUrl(data.url)
      }
    } catch (err) {
      fail(err)
    }
  } else {
    console.error(red(`Unknown command: ${opts.command}`))
    console.error(dim('Run gui help for usage'))
    process.exit(1)
  }
}

main()
