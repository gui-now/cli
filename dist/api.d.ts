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
    /** Name of the agent publishing, e.g. "Claude Code". A label, never auth. */
    agent?: string;
}
export declare function createCanvas(config: ClientConfig, content: string, opts?: CreateOptions): Promise<Canvas>;
export interface ExtendOptions {
    /** The page's edit token. Needed to choose a specific expiry. */
    token?: string;
    /** New expiry measured from now, clamped to the page's tier max. */
    expires?: string;
}
export declare function extendCanvas(config: ClientConfig, id: string, opts?: ExtendOptions): Promise<ExtendResult>;
