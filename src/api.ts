// Talks to the GUI API. Kept apart from the command-line handling so it can be
// tested without spawning the CLI.

export const DEFAULT_BASE_URL = 'https://gui.now'

// Lets the owner's library show "CLI" as the page's source (x-gui-client).
export const CLIENT = 'gui-now'

export interface Canvas {
  id: string
  url: string
  edit_token: string
  /** ISO timestamp, or null when the page never expires. */
  expires_at: string | null
  /** True when the requested --expires was longer than the caller's tier allows. */
  expires_clamped?: boolean
  /**
   * For pages made without an account or Pro key: a one-time link a person
   * opens to sign in and keep the page in their library.
   */
  claim_url?: string
  owned?: boolean
  pro?: boolean
  format?: string
  /** Fingerprint of what the page serves ("sha256:<hex>"), same as X-Content-Hash on /embed/<id>. */
  content_hash?: string
}

export interface UpdateResult {
  id: string
  updated: boolean
  /** Fields this update changed, e.g. ["html", "title"]. */
  changed: string[]
  /** Fields in the request the API didn't apply. */
  ignored?: string[]
  /** "markdown", "mermaid", "components" or "html" when the body changed format. */
  format?: string
  /** Fingerprint of what the page now serves; /embed/<id> sends it as X-Content-Hash. */
  content_hash?: string
  edit_count?: number
  /** Free pages only: edits left. */
  edits_remaining?: number
}

export interface DeleteResult {
  id: string
  deleted: boolean
}

export interface ExtendResult {
  id: string
  /** ISO timestamp, or null when the page never expires. */
  expires_at: string | null
  extended: boolean
  expires_clamped?: boolean
}

/** An error response from the GUI API, with its HTTP status. */
export class GuiError extends Error {
  readonly status: number
  /** On a 409 from extend: the latest expiry this page can reach. */
  readonly maxExpiresAt?: string
  /** On a 429: seconds until the limit resets. */
  readonly retryAfter?: string

  constructor(status: number, body: Record<string, unknown>, retryAfter?: string) {
    const message =
      status === 429
        ? `Rate limited. Try again in ${retryAfter || '3600'} seconds.`
        : typeof body.error === 'string' && body.error
          ? body.error
          : `API error (${status})`
    super(message)
    this.name = 'GuiError'
    this.status = status
    if (typeof body.max_expires_at === 'string') this.maxExpiresAt = body.max_expires_at
    if (retryAfter) this.retryAfter = retryAfter
  }
}

export interface ClientConfig {
  baseUrl?: string
  apiKey?: string
}

/**
 * Reads config from the environment. GUI_NEW_API_KEY is the pre-rename name,
 * still honored so existing Pro keys keep working. GUI_NOW_BASE_URL points the
 * CLI at a preview or local deploy.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Required<Pick<ClientConfig, 'baseUrl'>> & ClientConfig {
  return {
    baseUrl: (env.GUI_NOW_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: env.GUI_NOW_API_KEY || env.GUI_NEW_API_KEY || undefined,
  }
}

function headers(config: ClientConfig, extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-gui-client': CLIENT }
  if (config.apiKey) h['x-api-key'] = config.apiKey
  if (extra) Object.assign(h, extra)
  return h
}

async function check<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new GuiError(
      res.status,
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {},
      res.headers.get('Retry-After') ?? undefined
    )
  }
  return (await res.json()) as T
}

export interface CreateOptions {
  title?: string
  /** "30m", "24h", "7d" or "never". The server clamps to the caller's tier max. */
  expires?: string
  markdown?: boolean
  /** Send the content as a Mermaid diagram. */
  mermaid?: boolean
  /** "dark" or "light" for markdown or mermaid. Leave it out to follow the viewer. */
  theme?: string
  /** Name of the agent publishing, e.g. "Claude Code". A label, never auth. */
  agent?: string
}

export async function createCanvas(config: ClientConfig, content: string, opts: CreateOptions = {}): Promise<Canvas> {
  const body: Record<string, string> = {}
  if (opts.markdown && opts.mermaid) throw new Error('pick one of --markdown or --mermaid')
  if (opts.theme !== undefined && opts.theme !== 'dark' && opts.theme !== 'light') {
    throw new Error('--theme must be dark or light')
  }
  if (opts.markdown) body.markdown = content
  else if (opts.mermaid) body.mermaid = content
  else body.html = content
  if (opts.theme) body.theme = opts.theme
  if (opts.title) body.title = opts.title
  if (opts.expires) body.expires = opts.expires
  if (opts.agent) body.agent = opts.agent

  const res = await fetch(`${config.baseUrl || DEFAULT_BASE_URL}/api/canvas`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify(body),
  })
  return check<Canvas>(res)
}

export type BodyFormat = 'html' | 'markdown' | 'mermaid'

export interface UpdateOptions {
  /** The page's edit token. Required: account and agent keys can't update by key. */
  token?: string
  /** The new body, sent as `format`. Leave it out to change only the title. */
  content?: string
  format?: BodyFormat
  /** "dark" or "light" for a markdown or mermaid body. Leave it out to follow the viewer. */
  theme?: string
  title?: string
}

/**
 * Changes a page's body and/or title. Only the fields given are sent, so the
 * password and expiry stay as they are. Rejects anything the API would turn
 * away (or silently ignore) before calling it.
 */
export async function updateCanvas(config: ClientConfig, id: string, opts: UpdateOptions): Promise<UpdateResult> {
  if (!opts.token) {
    throw new Error('update needs --token <edit_token>, or GUI_NOW_EDIT_TOKEN set to it')
  }
  const format = opts.format ?? 'html'
  if (opts.theme !== undefined) {
    if (opts.theme !== 'dark' && opts.theme !== 'light') {
      throw new Error('--theme must be dark or light')
    }
    if (format === 'html' || opts.content === undefined) {
      throw new Error('--theme only applies with --markdown or --mermaid and new content')
    }
  }
  const body: Record<string, string> = {}
  if (opts.content !== undefined) body[format] = opts.content
  if (opts.theme !== undefined) body.theme = opts.theme
  if (opts.title !== undefined) body.title = opts.title
  if (Object.keys(body).length === 0) {
    throw new Error('Nothing to update. Pipe new content, pass a file, or use --title.')
  }
  const res = await fetch(`${config.baseUrl || DEFAULT_BASE_URL}/api/canvas/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: headers(config, { Authorization: `Bearer ${opts.token}` }),
    body: JSON.stringify(body),
  })
  return check<UpdateResult>(res)
}

export interface ExtendOptions {
  /** The page's edit token. Needed to choose a specific expiry. */
  token?: string
  /** New expiry measured from now, clamped to the page's tier max. */
  expires?: string
}

export async function extendCanvas(config: ClientConfig, id: string, opts: ExtendOptions = {}): Promise<ExtendResult> {
  // Without auth the API ignores `expires` and just adds 24h. Fail loudly
  // instead of letting someone think they got the expiry they asked for.
  if (opts.expires && !opts.token) {
    throw new Error('--expires needs --token <edit_token>; without it extend adds 24h')
  }
  const extra: Record<string, string> = {}
  if (opts.token) extra.Authorization = `Bearer ${opts.token}`
  const res = await fetch(`${config.baseUrl || DEFAULT_BASE_URL}/api/canvas/${encodeURIComponent(id)}/extend`, {
    method: 'POST',
    headers: headers(config, extra),
    ...(opts.expires ? { body: JSON.stringify({ expires: opts.expires }) } : {}),
  })
  return check<ExtendResult>(res)
}

/** True for the account keys made at gui.now/account, which can act as their owner. */
export function isAccountKey(key: string | undefined): boolean {
  return !!key && key.startsWith('gui_live_')
}

export interface DeleteOptions {
  /** The page's edit token. Without it, the account key in config must own the page. */
  token?: string
}

/**
 * Deletes a page for good. The edit token decides when it's sent; otherwise
 * the API checks that the account key belongs to the page's owner. A wrong
 * token and a missing page both come back as 404.
 */
export async function deleteCanvas(config: ClientConfig, id: string, opts: DeleteOptions = {}): Promise<DeleteResult> {
  if (!opts.token && !isAccountKey(config.apiKey)) {
    throw new Error('delete needs --token <edit_token>, or GUI_NOW_API_KEY set to one of your gui_live_ account keys')
  }
  const extra: Record<string, string> = {}
  if (opts.token) extra.Authorization = `Bearer ${opts.token}`
  const res = await fetch(`${config.baseUrl || DEFAULT_BASE_URL}/api/canvas/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: headers(config, extra),
  })
  return check<DeleteResult>(res)
}
