// Talks to the GUI API. Kept apart from the command-line handling so it can be
// tested without spawning the CLI.
export const DEFAULT_BASE_URL = 'https://gui.now';
// Lets the owner's library show "CLI" as the page's source (x-gui-client).
export const CLIENT = 'gui-now';
/** An error response from the GUI API, with its HTTP status. */
export class GuiError extends Error {
    status;
    /** On a 409 from extend: the latest expiry this page can reach. */
    maxExpiresAt;
    /** On a 429: seconds until the limit resets. */
    retryAfter;
    constructor(status, body, retryAfter) {
        const message = status === 429
            ? `Rate limited. Try again in ${retryAfter || '3600'} seconds.`
            : typeof body.error === 'string' && body.error
                ? body.error
                : `API error (${status})`;
        super(message);
        this.name = 'GuiError';
        this.status = status;
        if (typeof body.max_expires_at === 'string')
            this.maxExpiresAt = body.max_expires_at;
        if (retryAfter)
            this.retryAfter = retryAfter;
    }
}
/**
 * Reads config from the environment. GUI_NEW_API_KEY is the pre-rename name,
 * still honored so existing Pro keys keep working. GUI_NOW_BASE_URL points the
 * CLI at a preview or local deploy.
 */
export function configFromEnv(env = process.env) {
    return {
        baseUrl: (env.GUI_NOW_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
        apiKey: env.GUI_NOW_API_KEY || env.GUI_NEW_API_KEY || undefined,
    };
}
function headers(config, extra) {
    const h = { 'Content-Type': 'application/json', 'x-gui-client': CLIENT };
    if (config.apiKey)
        h['x-api-key'] = config.apiKey;
    if (extra)
        Object.assign(h, extra);
    return h;
}
async function check(res) {
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new GuiError(res.status, body && typeof body === 'object' ? body : {}, res.headers.get('Retry-After') ?? undefined);
    }
    return (await res.json());
}
export async function createCanvas(config, content, opts = {}) {
    const body = {};
    if (opts.markdown && opts.mermaid)
        throw new Error('pick one of --markdown or --mermaid');
    if (opts.theme !== undefined && opts.theme !== 'dark' && opts.theme !== 'light') {
        throw new Error('--theme must be dark or light');
    }
    if (opts.markdown)
        body.markdown = content;
    else if (opts.mermaid)
        body.mermaid = content;
    else
        body.html = content;
    if (opts.theme)
        body.theme = opts.theme;
    if (opts.title)
        body.title = opts.title;
    if (opts.expires)
        body.expires = opts.expires;
    if (opts.agent)
        body.agent = opts.agent;
    const res = await fetch(`${config.baseUrl || DEFAULT_BASE_URL}/api/canvas`, {
        method: 'POST',
        headers: headers(config),
        body: JSON.stringify(body),
    });
    return check(res);
}
/**
 * Changes a page's body and/or title. Only the fields given are sent, so the
 * password and expiry stay as they are. Rejects anything the API would turn
 * away (or silently ignore) before calling it.
 */
export async function updateCanvas(config, id, opts) {
    if (!opts.token) {
        throw new Error('update needs --token <edit_token>, or GUI_NOW_EDIT_TOKEN set to it');
    }
    const format = opts.format ?? 'html';
    if (opts.theme !== undefined) {
        if (opts.theme !== 'dark' && opts.theme !== 'light') {
            throw new Error('--theme must be dark or light');
        }
        if (format === 'html' || opts.content === undefined) {
            throw new Error('--theme only applies with --markdown or --mermaid and new content');
        }
    }
    const body = {};
    if (opts.content !== undefined)
        body[format] = opts.content;
    if (opts.theme !== undefined)
        body.theme = opts.theme;
    if (opts.title !== undefined)
        body.title = opts.title;
    if (Object.keys(body).length === 0) {
        throw new Error('Nothing to update. Pipe new content, pass a file, or use --title.');
    }
    const res = await fetch(`${config.baseUrl || DEFAULT_BASE_URL}/api/canvas/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: headers(config, { Authorization: `Bearer ${opts.token}` }),
        body: JSON.stringify(body),
    });
    return check(res);
}
export async function extendCanvas(config, id, opts = {}) {
    // Without auth the API ignores `expires` and just adds 24h. Fail loudly
    // instead of letting someone think they got the expiry they asked for.
    if (opts.expires && !opts.token) {
        throw new Error('--expires needs --token <edit_token>; without it extend adds 24h');
    }
    const extra = {};
    if (opts.token)
        extra.Authorization = `Bearer ${opts.token}`;
    const res = await fetch(`${config.baseUrl || DEFAULT_BASE_URL}/api/canvas/${encodeURIComponent(id)}/extend`, {
        method: 'POST',
        headers: headers(config, extra),
        ...(opts.expires ? { body: JSON.stringify({ expires: opts.expires }) } : {}),
    });
    return check(res);
}
/** True for the account keys made at gui.now/account, which can act as their owner. */
export function isAccountKey(key) {
    return !!key && key.startsWith('gui_live_');
}
/**
 * Deletes a page for good. The edit token decides when it's sent; otherwise
 * the API checks that the account key belongs to the page's owner. A wrong
 * token and a missing page both come back as 404.
 */
export async function deleteCanvas(config, id, opts = {}) {
    if (!opts.token && !isAccountKey(config.apiKey)) {
        throw new Error('delete needs --token <edit_token>, or GUI_NOW_API_KEY set to one of your gui_live_ account keys');
    }
    const extra = {};
    if (opts.token)
        extra.Authorization = `Bearer ${opts.token}`;
    const res = await fetch(`${config.baseUrl || DEFAULT_BASE_URL}/api/canvas/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: headers(config, extra),
    });
    return check(res);
}
