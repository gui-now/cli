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
  /** Name of the agent publishing, e.g. "Claude Code". A label, never auth. */
  agent?: string
}

export async function createCanvas(config: ClientConfig, content: string, opts: CreateOptions = {}): Promise<Canvas> {
  const body: Record<string, string> = {}
  if (opts.markdown) body.markdown = content
  else body.html = content
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
