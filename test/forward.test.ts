import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  callTool,
  createClient,
  DEFAULT_ENDPOINT_URL,
  parseRpcBody,
  PorefindClient,
  PROTOCOL_VERSION,
  TOOL_DEFS,
  TOOL_NAMES,
  VERSION,
} from "../src/forward.js";
import { createServer, handleCallTool } from "../src/mcp.js";
import type {
  FetchFn,
  FetchResponseLike,
  ToolDef,
  ToolResult,
} from "../src/types.js";

/**
 * Every test runs against a stubbed JSON-RPC upstream
 * implementing the streamable-HTTP session flow
 * (initialize -> notifications/initialized -> tools/call):
 * no live network, no live call — the real Filtrous
 * endpoint is never contacted.
 */

const FIXTURE_URL = new URL(
  "../../../harness/fixtures/filtrous-tools-original.json",
  import.meta.url,
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_URL);
const fixture = (
  FIXTURE_AVAILABLE
    ? JSON.parse(readFileSync(FIXTURE_URL, "utf-8"))
    : { tools: [] }
) as {
  tools: ToolDef[];
};

/**
 * Publish-survival guard (Wave 25 preflight, proven Wave 24 pattern):
 * the parity fixture lives in the build harness, outside the published
 * repo tree, so fixture-dependent tests skip cleanly when it is absent;
 * with the fixture present they run in full, with no skips.
 */
function skipWithoutFixture(t: {
  skip: (message: string) => void;
}): boolean {
  if (FIXTURE_AVAILABLE) return false;
  t.skip("parity fixture lives in the build harness, not the repo tree");
  return true;
}

const SAMPLE_RESULT = {
  content: [{ type: "text", text: "{\"products\":[],\"count\":0}" }],
  structuredContent: { count: 0 },
};

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface FakeOptions {
  callResult?: Record<string, unknown>;
  callBodyText?: string;
  callError?: Record<string, unknown>;
  callStatus?: number;
  initError?: Record<string, unknown>;
  throwOn?: "initialize" | "tools/call";
  sessionId?: string | null;
  hangOnCall?: boolean;
  sse?: boolean;
}

function makeResponse(
  status: number,
  bodyText: string,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const lowered = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lowered.get(name.toLowerCase()) ?? null },
    text: async () => bodyText,
  };
}

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return makeResponse(status, JSON.stringify(payload), headers);
}

function makeUpstream(options: FakeOptions = {}): {
  fetchFn: FetchFn;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    calls.push({ url, headers: init?.headers ?? {}, body });
    const method = body.method as string;
    if (options.throwOn === method) throw new Error("socket hang up");
    if (method === "initialize") {
      if (options.initError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.initError,
        });
      }
      const headers: Record<string, string> = {};
      const sessionId =
        options.sessionId === undefined ? "sess-xyz" : options.sessionId;
      if (sessionId !== null) headers["mcp-session-id"] = sessionId;
      return jsonResponse(
        200,
        {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: { name: "filtrous-catalog", version: "1.0.1" },
          },
        },
        headers,
      );
    }
    if (method === "notifications/initialized") {
      return makeResponse(202, "");
    }
    if (method === "tools/call") {
      if (options.hangOnCall) {
        return new Promise<FetchResponseLike>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
      if (options.callBodyText !== undefined) {
        return makeResponse(options.callStatus ?? 200, options.callBodyText);
      }
      if (options.callError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.callError,
        });
      }
      const result = options.callResult ?? SAMPLE_RESULT;
      const payload = { jsonrpc: "2.0", id: body.id, result };
      if (options.sse) {
        return makeResponse(
          200,
          `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
        );
      }
      return jsonResponse(options.callStatus ?? 200, payload);
    }
    return jsonResponse(200, {});
  };
  return { fetchFn, calls };
}

function stubClient(options: FakeOptions = {}, extra: Record<string, unknown> = {}) {
  const upstream = makeUpstream(options);
  const c = new PorefindClient({
    fetchFn: upstream.fetchFn,
    env: {},
    ...extra,
  });
  return { client: c, calls: upstream.calls };
}

function textOf(result: ToolResult): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

function methods(calls: Captured[]): string[] {
  return calls.map((c) => c.body.method as string);
}

/* ------------------------------------------------------------------ */

describe("registration integrity (labelled subset of the captured surface)", () => {
  it("serves exactly the fixture's 3 tools, deep-equal", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.equal(fixture.tools.length, 3);
    assert.deepEqual(TOOL_DEFS, fixture.tools);
  });

  it("serves the 3 tool names in fixture order", () => {
    assert.deepEqual(TOOL_NAMES, [
      "search_products",
      "get_product_details",
      "get_price_and_lead_time",
    ]);
  });

  it("carries exactly the fixture's required fields per tool", () => {
    const required = new Map(
      TOOL_DEFS.map((t) => [
        t.name,
        (t.inputSchema as { required?: string[] }).required ?? [],
      ]),
    );
    assert.deepEqual(required.get("search_products"), ["query"]);
    assert.deepEqual(required.get("get_product_details"), ["handle"]);
    assert.deepEqual(required.get("get_price_and_lead_time"), ["sku"]);
  });

  it("carries no keys beyond name/description/inputSchema on any tool", () => {
    for (const tool of TOOL_DEFS) {
      assert.deepEqual(Object.keys(tool).sort(), [
        "description",
        "inputSchema",
        "name",
      ]);
    }
  });

  it("does not contain request_quote, the omitted contact-routing tool", () => {
    assert.equal(TOOL_NAMES.includes("request_quote"), false);
    assert.equal(TOOL_DEFS.find((t) => t.name === "request_quote"), undefined);
  });
});

/* ------------------------------------------------------------------ */

describe("served MCP tools/list", () => {
  async function listServedTools() {
    const upstream = makeUpstream();
    const server = createServer({ fetchFn: upstream.fetchFn, env: {} });
    const client = new Client(
      { name: "porefind-test", version: "0.0.0" },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      return { tools: listed.tools, upstreamCalls: upstream.calls };
    } finally {
      await client.close();
      await server.close();
    }
  }

  it("the served tools/list deep-equals the fixture's 3 tools in order", async (t) => {
    if (skipWithoutFixture(t)) return;
    const { tools } = await listServedTools();
    assert.deepEqual(tools, fixture.tools);
  });

  it("the served tools/list omits request_quote", async () => {
    const { tools, upstreamCalls } = await listServedTools();
    assert.equal(tools.length, 3);
    assert.equal(
      tools.some((t) => t.name === "request_quote"),
      false,
    );
    // Listing tools is answered locally; nothing went upstream.
    assert.equal(upstreamCalls.length, 0);
  });
});

/* ------------------------------------------------------------------ */

describe("session establishment and reuse", () => {
  it("runs initialize, notifications/initialized, then tools/call in order", async () => {
    const { client: c, calls } = stubClient();
    const out = await c.callTool("search_products", { query: "PES filter" });
    assert.equal(out.isError, undefined);
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
    assert.ok(calls.every((call) => call.url === DEFAULT_ENDPOINT_URL));
    assert.equal(
      DEFAULT_ENDPOINT_URL,
      "https://filtrous-mcp-catalog.filtrous.workers.dev/mcp",
    );

    const initParams = calls[0].body.params as Record<string, unknown>;
    assert.equal(initParams.protocolVersion, PROTOCOL_VERSION);
    assert.deepEqual(initParams.capabilities, {});
    assert.deepEqual(initParams.clientInfo, {
      name: "porefind",
      version: VERSION,
    });
    assert.equal(calls[0].headers["Mcp-Session-Id"], undefined);
    for (const call of calls) {
      assert.equal(call.headers["Content-Type"], "application/json");
      assert.equal(
        call.headers["Accept"],
        "application/json, text/event-stream",
      );
    }
    assert.equal(calls[1].headers["Mcp-Session-Id"], "sess-xyz");
    assert.equal(calls[2].headers["Mcp-Session-Id"], "sess-xyz");
  });

  it("establishes the session lazily once and reuses it on later calls", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool("search_products", { query: "membrane" });
    await c.callTool("get_product_details", { handle: "pvdf-membrane-045" });
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
      "tools/call",
    ]);
    assert.equal(calls[3].headers["Mcp-Session-Id"], "sess-xyz");
    assert.notEqual(calls[2].body.id, calls[3].body.id);
  });

  it("sends no session header when the upstream issues none", async () => {
    const { client: c, calls } = stubClient({ sessionId: null });
    const out = await c.callTool("search_products", { query: "membrane" });
    assert.equal(out.isError, undefined);
    assert.ok(calls.every((call) => call.headers["Mcp-Session-Id"] === undefined));
  });

  it("honours the FILTROUS_MCP_URL env override", async () => {
    const upstream = makeUpstream();
    const c = new PorefindClient({
      fetchFn: upstream.fetchFn,
      env: { FILTROUS_MCP_URL: "https://staging.example.com/mcp" },
    });
    await c.callTool("search_products", { query: "membrane" });
    assert.ok(
      upstream.calls.every((call) => call.url === "https://staging.example.com/mcp"),
    );
  });

  it("honours an explicit url override over the default endpoint", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: {},
      url: "https://alt.example.com/mcp",
    });
    await c.callTool("search_products", { query: "membrane" });
    assert.ok(
      upstream.calls.every((call) => call.url === "https://alt.example.com/mcp"),
    );
  });
});

/* ------------------------------------------------------------------ */

describe("upstream auth header", () => {
  it("sends Authorization: Bearer <key> on every request when FILTROUS_API_KEY is set", async () => {
    const upstream = makeUpstream();
    const c = new PorefindClient({
      fetchFn: upstream.fetchFn,
      env: { FILTROUS_API_KEY: "test-key-123" },
    });
    await c.callTool("get_price_and_lead_time", { sku: "SF-PES-022-25" });
    assert.equal(upstream.calls.length, 3);
    assert.ok(
      upstream.calls.every(
        (call) => call.headers["Authorization"] === "Bearer test-key-123",
      ),
    );
  });

  it("sends no Authorization header when FILTROUS_API_KEY is unset", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool("search_products", { query: "membrane" });
    assert.ok(calls.every((call) => call.headers["Authorization"] === undefined));
  });
});

/* ------------------------------------------------------------------ */

describe("tools/call forwarding", () => {
  it("forwards search_products arguments verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = { query: "0.22 micron PES syringe filter", limit: 5 };
    await c.callTool("search_products", args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, "search_products");
    assert.deepEqual(params.arguments, args);
  });

  it("forwards get_product_details with its required handle", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool("get_product_details", { handle: "pes-syringe-filter-022" });
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, "get_product_details");
    assert.deepEqual(params.arguments, { handle: "pes-syringe-filter-022" });
  });

  it("forwards get_price_and_lead_time with its required sku", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool("get_price_and_lead_time", { sku: "SF-PES-022-25" });
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, "get_price_and_lead_time");
    assert.deepEqual(params.arguments, { sku: "SF-PES-022-25" });
  });

  it("passes the upstream result through verbatim, including extra fields", async () => {
    const { client: c } = stubClient();
    const out = await c.callTool("search_products", { query: "membrane" });
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("passes an upstream isError result through untouched", async () => {
    const upstreamResult = {
      content: [{ type: "text", text: "sku not found" }],
      isError: true,
    };
    const { client: c } = stubClient({ callResult: upstreamResult });
    const out = await c.callTool("get_price_and_lead_time", { sku: "NOPE" });
    assert.deepEqual(out, upstreamResult);
  });

  it("reads an SSE-framed tools/call response", async () => {
    const { client: c } = stubClient({ sse: true });
    const out = await c.callTool("search_products", { query: "membrane" });
    assert.equal(out.isError, undefined);
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("the one-shot callTool helper forwards under the right tool name", async () => {
    const upstream = makeUpstream();
    const out = await callTool(
      "get_product_details",
      { handle: "pes-syringe-filter-022" },
      { fetchFn: upstream.fetchFn, env: {} },
    );
    assert.equal(out.isError, undefined);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, "get_product_details");
    assert.deepEqual(params.arguments, { handle: "pes-syringe-filter-022" });
  });
});

/* ------------------------------------------------------------------ */

describe("upstream failures surface as porefind error text", () => {
  it("maps a JSON-RPC error to `porefind error: <message>`", async () => {
    const { client: c } = stubClient({
      callError: { code: -32000, message: "invalid API key" },
    });
    const out = await c.callTool("get_price_and_lead_time", { sku: "X-1" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "porefind error: invalid API key");
  });

  it("maps an initialize JSON-RPC error to porefind error text", async () => {
    const { client: c } = stubClient({
      initError: { code: -32600, message: "bad initialize" },
    });
    const out = await c.callTool("search_products", { query: "membrane" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "porefind error: bad initialize");
  });

  it("maps an unparseable upstream response to a malformed-response error", async () => {
    const { client: c } = stubClient({ callBodyText: "<html>oops</html>" });
    const out = await c.callTool("search_products", { query: "membrane" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "porefind error: malformed response");
  });

  it("maps a non-2xx upstream status to porefind error text", async () => {
    const { client: c } = stubClient({
      callBodyText: "internal error",
      callStatus: 500,
    });
    const out = await c.callTool("search_products", { query: "membrane" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "porefind error: HTTP 500");
  });

  it("maps a throwing fetch to porefind error text", async () => {
    const { client: c } = stubClient({ throwOn: "tools/call" });
    const out = await c.callTool("search_products", { query: "membrane" });
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^porefind error: /);
  });

  it("maps a throwing initialize fetch to porefind error text", async () => {
    const { client: c } = stubClient({ throwOn: "initialize" });
    const out = await c.callTool("search_products", { query: "membrane" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "porefind error: socket hang up");
  });

  it("maps a timed-out call to porefind error text", async () => {
    const { client: c } = stubClient({ hangOnCall: true }, { timeoutMs: 20 });
    const out = await c.callTool("search_products", { query: "membrane" });
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^porefind error: /);
  });
});

/* ------------------------------------------------------------------ */

describe("parseRpcBody", () => {
  it("parses plain JSON and picks the message with the matching id", () => {
    const body = '{"jsonrpc":"2.0","id":7,"result":{"ok":true}}';
    assert.deepEqual(parseRpcBody(body, 7), {
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
  });

  it("parses SSE data lines", () => {
    const body =
      'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), {
      jsonrpc: "2.0",
      id: 2,
      result: { ok: true },
    });
  });

  it("returns null for empty and unparseable bodies", () => {
    assert.equal(parseRpcBody(""), null);
    assert.equal(parseRpcBody("not json at all"), null);
  });
});

/* ------------------------------------------------------------------ */

describe("MCP layer validation", () => {
  it("rejects an unknown tool before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "not_a_tool", {}),
      (err: unknown) => err instanceof McpError,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects request_quote at the MCP layer before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () =>
        handleCallTool(c, "request_quote", {
          items: [{ sku: "SF-PES-022-25", quantity: 10 }],
          contact: { email: "buyer@example.com" },
        }),
      (err: unknown) => err instanceof McpError,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects non-object arguments before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "search_products", ["nope"]),
      (err: unknown) => err instanceof McpError,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("forwards a valid call through the MCP layer unchanged", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, "search_products", {
      query: "tag:sterile",
      limit: 3,
    });
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, { query: "tag:sterile", limit: 3 });
  });
});

/* ------------------------------------------------------------------ */

describe("CLI", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

  function runCli(args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
  }

  it("--version prints 0.1.0 and exits 0", () => {
    const res = runCli(["--version"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
  });

  it("an unknown command prints usage on stderr and exits 2", () => {
    const res = runCli(["not-a-tool"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Usage:/);
  });

  it("request_quote is not a CLI subcommand and exits 2", () => {
    const res = runCli(["request_quote", '{"items":[],"contact":{}}']);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Usage:/);
  });

  it("a non-JSON argument exits 2", () => {
    const res = runCli(["search_products", "not json"]);
    assert.equal(res.status, 2);
  });

  it("a JSON array argument exits 2", () => {
    const res = runCli(["search_products", "[]"]);
    assert.equal(res.status, 2);
  });
});
