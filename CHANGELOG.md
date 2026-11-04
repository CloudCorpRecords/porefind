# Changelog

## 0.1.0 (2026-10-27)

- First release: a forwarding client for the hosted Filtrous MCP catalog, serving a labelled subset of 3 of the 4 captured tools locally for tools/list and forwarding every tools/call upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, honouring the Mcp-Session-Id header when issued).
- Tools: `search_products`, `get_product_details`, `get_price_and_lead_time`.
- The captured fourth tool, `request_quote`, is omitted under the program's safety rule: it routes a contact object to the vendor's sales pipeline. It is not registered, not forwarded, and its absence is asserted by tests.
- Upstream results pass through verbatim; upstream failures surface as `porefind error:` text results.
- One bin serves the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp` subcommand). Upstream endpoint overridable via `FILTROUS_MCP_URL`; when `FILTROUS_API_KEY` is set it is sent as a Bearer token on every upstream request.
