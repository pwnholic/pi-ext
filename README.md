# pi-ext

Web search and content fetching for the Pi coding agent. Zero-config-ish web
research built on [Exa](https://exa.ai) for search and
[impers](https://github.com/lexiforest/impers) (curl-impersonate) for fetching,
with structure-aware content windowing so large pages never flood the agent's
context.

> Status: pre-1.0. The core is implemented and tested; the binding to the Pi
> extension SDK goes through a single adapter (`src/extension/adapter.ts`) that
> targets an assumed host API shape — reconcile it with the real
> `@earendil-works/pi-coding-agent` surface when wiring into Pi.

## Features

- **Web search (`web_search`)** — Exa-backed, tuned for maximum quality on the
  free/basic plan: `type: "auto"`, `useAutoprompt`, highlights, results capped
  at the plan limit, budgeted text retrieval.
- **Content fetch (`fetch_content`)** — fetches via impers to defeat common bot
  protection (browser TLS/HTTP fingerprint impersonation), then extracts clean
  markdown with a readability-style pipeline (noise removal, content scoring,
  DOM-to-markdown).
- **Context-lean output** — large pages return a navigable section _outline_
  instead of raw content. Detail is pulled on demand via `get_content`, keeping
  the context window small.
- **Section retrieval (`get_content`)** — fetch one section, browse the outline,
  or rank-search sections. Backed by SQLite FTS5 (BM25) with an in-memory
  fallback.
- **Summarization** — optional map-reduce LLM summary of a fetched page
  (`fetch_content({ summarize: true })`), backed by Pi's own model (no extra
  API key).

## Requirements

- Node.js >= 20 (developed on 26; uses `node:sqlite`, which is experimental).
- Optional: an Exa API key for search; the free tier includes credits.

## Install

```bash
npm install
```

Runtime dependencies: `exa-js`, `impers` (pulls native `koffi` + downloads
curl-impersonate on first use), `linkedom`.

## Configuration

Resolution order: built-in defaults < config file < environment variables.

Config file (optional), read from `$PI_CODING_AGENT_DIR`, `$XDG_CONFIG_HOME/pi`,
or `~/.pi` as `web-access.json`:

```json
{
    "logLevel": "info",
    "search": { "exaApiKey": "exa-...", "defaultNumResults": 5 },
    "fetch": { "impersonate": "chrome", "proxy": "http://localhost:3128" },
    "content": { "inlineMaxChars": 6000, "maxSectionChars": 4000, "fts": true }
}
```

Environment overrides (take precedence over the file):

| Variable             | Effect                                                    |
| -------------------- | --------------------------------------------------------- |
| `EXA_API_KEY`        | Exa search API key                                        |
| `IMPERS_PROXY`       | HTTP/SOCKS proxy for fetches                              |
| `IMPERS_IMPERSONATE` | impersonation target (e.g. `chrome`, `safari`, `firefox`) |
| `PI_EXT_LOG_LEVEL`   | `debug` \| `info` \| `warn` \| `error`                    |

Without an Exa key, `web_search` reports `provider_unavailable` by design;
`fetch_content` works regardless.

## Tools

### `web_search`

```ts
web_search({ query: "rust async runtime comparison" });
web_search({
    queries: ["...", "..."],
    numResults: 8,
    recency: "month",
    domains: ["github.com", "-pinterest.com"],
});
```

Returns synthesized hits (title, url, snippet from Exa highlights) per query.

### `fetch_content`

```ts
fetch_content({ url: "https://example.com/guide" });
fetch_content({ urls: ["...", "..."], impersonate: "safari" });
fetch_content({
    url: "...",
    summarize: true,
    summaryStyle: "bullets",
    summarySentences: 5,
});
```

Small pages return inline markdown. Large pages return a section outline plus a
`responseId`; retrieve detail with `get_content`. `summarize: true` returns an
LLM summary instead of the body.

### `get_content`

```ts
get_content({ responseId: "abc123" }); // outline of sections
get_content({ responseId: "abc123", index: 0, section: "2" }); // one section in full
get_content({ responseId: "abc123", query: "installation" }); // rank-search sections
```

## Architecture

Ports-and-adapters with explicit decorator composition (no event bus). The
request path returns a `Result<T, AppError>`; cross-cutting concerns are applied
as ordered, type-safe wrappers in the composition root.

```
src/
  core/
    container.ts        composition root (wires everything)
    pipeline.ts         buildSearcher/Fetcher/Summarizer (cache + telemetry decorators)
    instrument.ts       instrument() telemetry + readThrough() cache decorators
    activity-monitor.ts live activity ledger (onUpdate for a widget)
    store.ts            CacheStore port + InMemoryStore (TTL + LRU)
    content-store.ts    ContentStore port + InMemoryContentStore + presenters
    sqlite-content-store.ts  SQLite/FTS5 ContentStore
    sections.ts         markdown -> addressable sections + keyword scoring
    config.ts result.ts errors.ts logger.ts llm.ts
  modules/
    search/   SearchService (Exa provider chain)
    fetch/    FetchService (impers) + extract/ (noise -> score -> markdown)
    summarize/ SummarizeService (map-reduce, Pi LLM)
  extension/
    ports.ts adapter.ts register.ts   Pi host boundary
    tools/   web-search, fetch-content, get-content
  index.ts   activate(pi)
```

Key decisions:

- **Decorators over an event bus.** Caching and telemetry wrap services
  explicitly (`buildSearcher(base, inst, cache)`), giving a linear, traceable,
  type-safe flow. The read-through cache is correct (no write-only path).
- **Structure-aware content windowing.** The extractor's markdown is split into
  heading sections; the agent sees the whole outline and pulls only what it
  needs, rather than a head-truncated blob.
- **Pluggable storage.** `ContentStore` has a first-class `search()`, so the
  SQLite/FTS5 adapter ranks natively (BM25) while the in-memory adapter uses a
  term-frequency scorer — callers are unchanged.

The content extraction pipeline (`modules/fetch/extract/`) is a TypeScript port
of the algorithm from [webclaw](https://github.com/0xMassi/webclaw) (MIT),
reimplemented over `linkedom`.

## Development

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # biome lint
npm run format        # biome format --write
npm run test          # vitest run
npm run check         # typecheck + lint + format check + test
npm run build         # emit to dist/
```

Tooling: TypeScript (strict, NodeNext, ESM), Biome (strict lint + format),
Vitest. Run `npm run check` before committing.

## License

MIT
