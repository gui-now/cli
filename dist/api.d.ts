export declare const DEFAULT_BASE_URL = "https://gui.now";
export declare const CLIENT = "gui-now";
export interface Canvas {
    id: string;
    url: string;
    edit_token: string;
    /** ISO timestamp, or null when the page never expires. */
    expires_at: string | null;
    /** True when the requested --expires was longer than the caller's tier allows. */
    expires_clamped?: boolean;
    /**
     * For pages made without an account or Pro key: a one-time link a person
     * opens to sign in and keep the page in their library.
     */
    claim_url?: string;
    owned?: boolean;
    pro?: boolean;
    format?: string;
    /** Fingerprint of what the page serves ("sha256:<hex>"), same as X-Content-Hash on /embed/<id>. */
    content_hash?: string;
}
export interface UpdateResult {
    id: string;
    updated: boolean;
    /** Fields this update changed, e.g. ["html", "title"]. */
    changed: string[];
    /** Fields in the request the API didn't apply. */
    ignored?: string[];
    /** "markdown", "mermaid", "components" or "html" when the body changed format. */
    format?: string;
    /** Fingerprint of what the page now serves; /embed/<id> sends it as X-Content-Hash. */
    content_hash?: string;
    edit_count?: number;
    /** Free pages only: edits left. */
    edits_remaining?: number;
}
export interface DeleteResult {
    id: string;
    deleted: boolean;
}
export interface ExtendResult {
    id: string;
    /** ISO timestamp, or null when the page never expires. */
    expires_at: string | null;
    extended: boolean;
    expires_clamped?: boolean;
}
/** An error response from the GUI API, with its HTTP status. */
export declare class GuiError extends Error {
    readonly status: number;
    /** On a 409 from extend: the latest expiry this page can reach. */
    readonly maxExpiresAt?: string;
    /** On a 429: seconds until the limit resets. */
    readonly retryAfter?: string;
    constructor(status: number, body: Record<string, unknown>, retryAfter?: string);
}
export interface ClientConfig {
    baseUrl?: string;
    apiKey?: string;
}
/**
 * Reads config from the environment. GUI_NEW_API_KEY is the pre-rename name,
 * still honored so existing Pro keys keep working. GUI_NOW_BASE_URL points the
 * CLI at a preview or local deploy.
 */
export declare function configFromEnv(env?: NodeJS.ProcessEnv): Required<Pick<ClientConfig, 'baseUrl'>> & ClientConfig;
export interface CreateOptions {
    title?: string;
    /** "30m", "24h", "7d" or "never". The server clamps to the caller's tier max. */
    expires?: string;
    markdown?: boolean;
    /** Send the content as a Mermaid diagram. */
    mermaid?: boolean;
    /** "dark" or "light" for markdown or mermaid. Leave it out to follow the viewer. */
    theme?: string;
    /** Name of the agent publishing, e.g. "Claude Code". A label, never auth. */
    agent?: string;
}
export declare function createCanvas(config: ClientConfig, content: string, opts?: CreateOptions): Promise<Canvas>;
export type BodyFormat = 'html' | 'markdown' | 'mermaid';
export interface UpdateOptions {
    /** The page's edit token. Required: account and agent keys can't update by key. */
    token?: string;
    /** The new body, sent as `format`. Leave it out to change only the title. */
    content?: string;
    format?: BodyFormat;
    /** "dark" or "light" for a markdown or mermaid body. Leave it out to follow the viewer. */
    theme?: string;
    title?: string;
}
/**
 * Changes a page's body and/or title. Only the fields given are sent, so the
 * password and expiry stay as they are. Rejects anything the API would turn
 * away (or silently ignore) before calling it.
 */
export declare function updateCanvas(config: ClientConfig, id: string, opts: UpdateOptions): Promise<UpdateResult>;
export interface ExtendOptions {
    /** The page's edit token. Needed to choose a specific expiry. */
    token?: string;
    /** New expiry measured from now, clamped to the page's tier max. */
    expires?: string;
}
export declare function extendCanvas(config: ClientConfig, id: string, opts?: ExtendOptions): Promise<ExtendResult>;
/** True for the account keys made at gui.now/account, which can act as their owner. */
export declare function isAccountKey(key: string | undefined): boolean;
export interface DeleteOptions {
    /** The page's edit token. Without it, the account key in config must own the page. */
    token?: string;
}
/**
 * Deletes a page for good. The edit token decides when it's sent; otherwise
 * the API checks that the account key belongs to the page's owner. A wrong
 * token and a missing page both come back as 404.
 */
export declare function deleteCanvas(config: ClientConfig, id: string, opts?: DeleteOptions): Promise<DeleteResult>;
