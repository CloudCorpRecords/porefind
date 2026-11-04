/**
 * porefind MCP server. Tools: the 3 kept Filtrous
 * catalog tools (see forward.ts). The captured fourth
 * tool, request_quote, is omitted under the safety
 * rule and is rejected here like any unknown name.
 *
 * Why the low-level Server instead of McpServer: the
 * high-level helper turns zod schemas into JSON Schema
 * and rewrites what gets served, which breaks exact
 * parity with the captured tool list. This file answers
 * tools/list locally from the core's explicit literals —
 * the kept tool objects exactly as captured upstream —
 * and forwards every tools/call to the upstream server.
 *
 * A forwarded result is returned unchanged (including
 * any upstream isError flag and extra result fields). An
 * upstream failure comes back as an isError result
 * carrying a `porefind error:` text, synthesised by the
 * forwarding client. A name outside the kept set is
 * rejected with McpError MethodNotFound, and arguments
 * that are not a JSON object with McpError
 * InvalidParams, before any network hop.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createClient,
  isKnownTool,
  TOOL_DEFS,
  VERSION,
  type PorefindClient,
} from "./forward.js";
import type { ForwardDeps, ToolResult } from "./types.js";

/**
 * Validate and forward one tools/call through `client`.
 * Exported so the MCP layer can be exercised in tests
 * without a stdio transport.
 */
export async function handleCallTool(
  client: PorefindClient,
  name: string,
  args: unknown,
): Promise<ToolResult> {
  if (!isKnownTool(name)) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
  if (
    args !== undefined &&
    (typeof args !== "object" || args === null || Array.isArray(args))
  ) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Arguments for tool ${name} must be a JSON object`,
    );
  }
  return client.callTool(name, (args ?? {}) as Record<string, unknown>);
}

/** Build the stdio MCP server (transport not yet connected). */
export function createServer(deps: ForwardDeps = {}): Server {
  const client = createClient(deps);
  const server = new Server(
    { name: "porefind", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await handleCallTool(client, name, args);
    return result as never;
  });

  return server;
}

/** Connect the MCP server over stdio. */
export async function startMcpServer(deps: ForwardDeps = {}): Promise<void> {
  await createServer(deps).connect(new StdioServerTransport());
}
