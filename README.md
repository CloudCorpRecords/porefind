# porefind

porefind is a thin local bridge to Filtrous' hosted
catalog of laboratory filtration products: syringe
filters, membranes, filter paper and the like, each
with its pore size, material, SKU, price and stock
position. The bridge stores nothing. It presents the
upstream server's tool list locally, exactly as
captured, and passes each tool call through to the
remote endpoint, handing back whatever comes back
untouched.

Catalog work here is read-only. You can search the
catalog by free text or by specification terms, open
one product for its full detail — variants, options,
images and spec metafields — and ask for the current
price and lead time on a single SKU. Pricing for the
last of these sits behind the upstream's API key, as
its own description says.

## Labelled subset: 3 of 4 tools

The live capture of the upstream server listed four
tools. This build serves three. The fourth,
`request_quote`, took a list of items plus a
`contact` object and submitted them to the vendor as
a quote request — personal contact details routed
into a sales pipeline. That is out of scope for this
program under its safety rule, so the tool is
omitted entirely: it is not registered, it does not
appear in tools/list, calls to it are rejected like
any unknown name, and the test suite asserts its
absence at both the registry and the served MCP
layer.

## Tools

- `search_products` — search the catalog by free
  text and/or spec terms (for example
  `0.22 micron PES syringe filter`); field filters
  such as `product_type:...` or `tag:...` are also
  honoured. Returns matching products with title,
  handle, SKU, product type, tags, price and
  availability. Required: `query`. Optional:
  `limit` (1-50, default 10).
- `get_product_details` — full detail for one
  product by its handle (the slug a search returns):
  variants, SKUs, options, prices, images and spec
  metafields. Required: `handle`.
- `get_price_and_lead_time` — current price,
  availability and, when permitted, stock for one
  exact SKU. Required: `sku`. This is the keyed
  tool: it needs a valid API key upstream.

## Configuration

- `FILTROUS_MCP_URL` (optional) — override the
  upstream endpoint. Defaults to
  `https://filtrous-mcp-catalog.filtrous.workers.dev/mcp`.
  (The override hook is this rebuild's own labelled
  reconstruction.)
- `FILTROUS_API_KEY` (optional) — when set, every
  upstream request carries an
  `Authorization: Bearer <key>` header; when it is
  not set, no auth header is sent. (This forwarding
  is also a labelled reconstruction; the original
  surface was captured keyless.)

### Forwarding mechanics

The first tool call opens a streamable HTTP session
with the upstream: a JSON-RPC `initialize` request
(protocolVersion `2025-03-26`, clientInfo name
`porefind`), then a `notifications/initialized`
notification, then the `tools/call` request carrying
the caller's arguments unchanged. If the upstream's
`initialize` reply carries an `Mcp-Session-Id`
header, that value rides on every later request of
the session, which is reused for the life of the
process. Replies may arrive as plain JSON or as
server-sent events; both are read.

Successful upstream results pass through verbatim,
including any `isError` flag the upstream sets.
Failures — a JSON-RPC error, a non-2xx status, an
unreadable response, or a request that cannot be
completed — come back as an `isError` result whose
text starts with `porefind error:` (this rendering
is this rebuild's own labelled reconstruction).

## CLI

Each kept tool is also a subcommand taking one JSON
argument string:

```bash
npx @reneturcios/porefind search_products '{"query":"0.22 micron PES syringe filter","limit":5}'
npx @reneturcios/porefind get_product_details '{"handle":"pes-syringe-filter-022"}'
npx @reneturcios/porefind get_price_and_lead_time '{"sku":"SF-PES-022-25"}'
npx @reneturcios/porefind --version
```

Exit codes: `0` on success, `1` on an `isError`
result, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/porefind mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "porefind": {
      "command": "npx",
      "args": ["-y", "@reneturcios/porefind", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/porefind
docker run --rm ghcr.io/cloudcorprecords/porefind --version
```

The container's default command is `mcp`, so the
first form is a stdio MCP server; any other
arguments reach the CLI normally.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

The test suite runs entirely against a stubbed
JSON-RPC upstream — no live network calls.

## License

MIT — see `LICENSE`.
