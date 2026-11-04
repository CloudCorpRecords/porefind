/**
 * porefind types.
 *
 * porefind holds no catalog data locally. It is a
 * forwarding bridge: the kept tool definitions live here
 * as plain data (ToolDef entries, served exactly as
 * captured for tools/list) and each tools/call travels
 * to the hosted Filtrous MCP endpoint through an
 * injectable fetch, so the whole suite can run against a
 * stub and never touch the live network.
 */

/** One kept tool definition, served verbatim for tools/list. */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  [key: string]: unknown;
}

/** The arguments of one tool call, as decoded JSON. */
export type ToolArgs = Record<string, unknown>;

/** A tools/call result: upstream results pass through verbatim; local failures use this shape. */
export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

/** The narrow slice of a fetch Response the forwarding client depends on. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Injectable fetch, so tests never touch the live network. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/** Dependencies of the forwarding client, every one injectable in tests. */
export interface ForwardDeps {
  /** Fetch implementation. Defaults to the global fetch. */
  fetchFn?: FetchFn;
  /** Environment (FILTROUS_MCP_URL, FILTROUS_API_KEY). Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Endpoint URL override. Defaults to env FILTROUS_MCP_URL or the pinned default. */
  url?: string;
  /** Per-request timeout in ms. Defaults to 30000. */
  timeoutMs?: number;
}
