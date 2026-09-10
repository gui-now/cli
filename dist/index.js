#!/usr/bin/env node
import { readFileSync } from 'fs';
import { execFile } from 'child_process';
const API_URL = 'https://gui.now/api/canvas';
const isTTY = process.stdout.isTTY ?? false;
// Simple ANSI colors (only when TTY)
const green = (s) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s);
const dim = (s) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s);
function printHelp() {
    console.log(`
${bold('gui')} — pipe HTML to gui.now, get a shareable URL

${bold('USAGE')}
  gui push [file] [options]    Create a canvas
  gui open <id>                Open a canvas in the browser
  gui help                     Show this help

${bold('EXAMPLES')}
  cat index.html | gui push
  gui push index.html --title "My Dashboard"
  gui push --markdown README.md
  echo "<h1>Hello</h1>" | gui push --open

${bold('OPTIONS')}
  -t, --title <title>     Canvas title
  -e, --expires <dur>     Expiry: 1h, 24h, 7d, 14d, 30d
  -m, --markdown          Treat input as markdown
  -o, --open              Open URL in browser after creation
  -j, --json              Output full JSON response
  -h, --help              Show help

${bold('ENVIRONMENT')}
  GUI_NOW_API_KEY          Pro API key for higher limits
`);
}
function parseArgs(argv) {
    const result = {
        command: '',
        file: undefined,
        title: undefined,
        expires: undefined,
        markdown: false,
        json: false,
        open: false,
        help: false,
        id: undefined,
    };
    const args = argv.slice(2);
    let i = 0;
    // First positional = command
    if (args.length > 0 && !args[0].startsWith('-')) {
        result.command = args[0];
        i = 1;
    }
    while (i < args.length) {
        const arg = args[i];
        switch (arg) {
            case '-t':
            case '--title':
                result.title = args[++i];
                break;
            case '-e':
            case '--expires':
                result.expires = args[++i];
                break;
            case '-m':
            case '--markdown':
                result.markdown = true;
                break;
            case '-j':
            case '--json':
                result.json = true;
                break;
            case '-o':
            case '--open':
                result.open = true;
                break;
            case '-h':
            case '--help':
                result.help = true;
                break;
            default:
                // Positional: file or id
                if (!result.file && !arg.startsWith('-')) {
                    if (result.command === 'open') {
                        result.id = arg;
                    }
                    else {
                        result.file = arg;
                    }
                }
                break;
        }
        i++;
    }
    return result;
}
function readStdin() {
    return new Promise((resolve, reject) => {
        // An interactive terminal means nothing is being piped in.
        if (process.stdin.isTTY) {
            resolve('');
            return;
        }
        const chunks = [];
        let sawData = false;
        // stdin can be an open pipe with no writer, in which case 'end' never
        // fires and we wait forever. A timeout would fix the hang but would also
        // truncate a slow producer, which is worse -- `slow-command | gui push`
        // is legitimate and may take seconds to emit its first byte. So keep
        // waiting, but say so, and only on a terminal where it will not pollute
        // piped output.
        const hint = setTimeout(() => {
            if (!sawData && isTTY) {
                console.error(dim('Waiting for input on stdin... (Ctrl-C to cancel)'));
            }
        }, 2000);
        hint.unref();
        process.stdin.on('data', (chunk) => {
            sawData = true;
            clearTimeout(hint);
            chunks.push(chunk);
        });
        process.stdin.on('end', () => {
            clearTimeout(hint);
            resolve(Buffer.concat(chunks).toString('utf-8'));
        });
        process.stdin.on('error', (err) => {
            clearTimeout(hint);
            reject(err);
        });
    });
}
function openUrl(url) {
    // execFile, not exec: the URL can carry a canvas id straight from argv, and
    // interpolating that into a shell string lets `gui open '$(...)'` run it.
    if (process.platform === 'darwin') {
        execFile('open', [url]);
    }
    else if (process.platform === 'win32') {
        // `start` is a cmd.exe builtin, so it needs a shell to live in. The empty
        // string is the window title cmd would otherwise take the URL to be.
        execFile('cmd', ['/c', 'start', '', url]);
    }
    else {
        execFile('xdg-open', [url]);
    }
}
async function createCanvas(content, opts) {
    const body = {};
    if (opts.markdown) {
        body.markdown = content;
    }
    else {
        body.html = content;
    }
    if (opts.title)
        body.title = opts.title;
    if (opts.expires)
        body.expires = opts.expires;
    const headers = { 'Content-Type': 'application/json' };
    // GUI_NEW_API_KEY is the pre-rename name; still honoured so existing Pro
    // keys keep working without the user having to re-export anything.
    const apiKey = process.env.GUI_NOW_API_KEY || process.env.GUI_NEW_API_KEY;
    if (apiKey)
        headers['x-api-key'] = apiKey;
    const res = await fetch(API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After') || '3600';
        throw new Error(`Rate limited. Try again in ${retryAfter} seconds.`);
    }
    const data = (await res.json());
    if (!res.ok) {
        throw new Error(data.error || `API error (${res.status})`);
    }
    return data;
}
async function main() {
    const opts = parseArgs(process.argv);
    if (opts.help || (!opts.command && process.argv.length <= 2)) {
        printHelp();
        process.exit(0);
    }
    if (opts.command === 'help') {
        printHelp();
        process.exit(0);
    }
    if (opts.command === 'open') {
        if (!opts.id) {
            console.error(red('Error: gui open requires a canvas ID'));
            process.exit(1);
        }
        openUrl(`https://gui.now/${opts.id}`);
        console.log(dim(`Opening https://gui.now/${opts.id}`));
        process.exit(0);
    }
    if (opts.command === 'push') {
        let content = '';
        if (opts.file) {
            try {
                content = readFileSync(opts.file, 'utf-8');
            }
            catch (err) {
                console.error(red(`Error: Cannot read file '${opts.file}'`));
                process.exit(1);
            }
        }
        else {
            try {
                content = await readStdin();
            }
            catch (err) {
                console.error(red(`Error: Cannot read stdin — ${err.message}`));
                process.exit(1);
            }
        }
        if (!content.trim()) {
            console.error(red('Error: No content provided. Pipe HTML or pass a file.'));
            console.error(dim('  cat index.html | gui push'));
            console.error(dim('  gui push index.html'));
            process.exit(1);
        }
        try {
            const data = await createCanvas(content, {
                title: opts.title,
                expires: opts.expires,
                markdown: opts.markdown,
            });
            if (opts.json) {
                console.log(JSON.stringify(data, null, 2));
            }
            else {
                console.log(green(data.url));
                if (isTTY) {
                    console.log(dim(`expires ${data.expires_at}`));
                }
            }
            if (opts.open) {
                openUrl(data.url);
            }
        }
        catch (err) {
            console.error(red(`Error: ${err.message}`));
            process.exit(1);
        }
    }
    else {
        console.error(red(`Unknown command: ${opts.command}`));
        console.error(dim('Run gui help for usage'));
        process.exit(1);
    }
}
main();
