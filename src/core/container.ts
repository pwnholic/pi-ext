import { type Answerer, AnswerService } from '../modules/answer/answer.service.js';
import { ExaAnswerProvider } from '../modules/answer/providers/exa.provider.js';
import { type Fetcher, FetchService } from '../modules/fetch/fetch.service.js';
import { ExaContentsProvider } from '../modules/fetch/providers/exa.provider.js';
import { ImpersFetchProvider } from '../modules/fetch/providers/impers.provider.js';
import { ExaSearchProvider } from '../modules/search/providers/exa.provider.js';
import { type Searcher, SearchService } from '../modules/search/search.service.js';
import { type Summarizer, SummarizeService } from '../modules/summarize/summarize.service.js';
import { type AppConfig, loadConfigFile, resolveConfig } from './config.js';
import { type ContentStore, InMemoryContentStore } from './content-store.js';
import type { LlmClient } from './llm.js';
import { buildAnswerer, buildFetcher, buildSearcher } from './pipeline.js';
import { SqliteContentStore } from './sqlite-content-store.js';
import { type CacheStore, InMemoryStore } from './store.js';

/**
 * Composition root. Constructs providers and base services, then wraps them
 * with the read-through cache decorator. This is the only place objects are
 * wired, so the dependency graph is visible in one file.
 */
export interface Container {
    readonly config: AppConfig;
    readonly content: ContentStore;
    readonly search: Searcher;
    readonly fetch: Fetcher;
    readonly summarize: Summarizer;
    readonly answer: Answerer;
    dispose(): Promise<void>;
}

export interface ContainerOptions {
    readonly config?: Partial<AppConfig>;
    /** Pi-backed LLM client; when omitted, summarization is unavailable. */
    readonly llm?: LlmClient;
}

/** Build the content store, preferring SQLite/FTS5 with a graceful fallback. */
function createContentStore(config: AppConfig): ContentStore {
    if (config.content.fts) {
        try {
            return new SqliteContentStore({ maxResponses: config.content.maxResponses });
        } catch {
            // sqlite content store unavailable, fall back to in-memory
        }
    }
    return new InMemoryContentStore({ maxResponses: config.content.maxResponses });
}

export function createContainer(options: ContainerOptions = {}): Container {
    const fileConfig = options.config ?? loadConfigFile(process.env);
    const config = resolveConfig(process.env, fileConfig);

    const exaSearch = new ExaSearchProvider(config);
    const exaAnswer = new ExaAnswerProvider(config);
    const exaContents = new ExaContentsProvider(config);
    const impers = new ImpersFetchProvider(config);

    const content = createContentStore(config);
    const cache: CacheStore | undefined = config.cache.enabled
        ? new InMemoryStore({ ttlMs: config.cache.ttlMs, maxEntries: config.cache.maxEntries })
        : undefined;

    const retryConfig = {
        maxRetries: config.retry.maxRetries,
        baseDelayMs: config.retry.baseDelayMs,
        maxDelayMs: config.retry.maxDelayMs,
    };

    const search = buildSearcher(new SearchService({ providers: [exaSearch], retry: retryConfig }), cache);
    const fetch = buildFetcher(
        new FetchService({ providers: [impers, exaContents], retry: retryConfig }),
        cache,
    );
    const summarize = new SummarizeService({ llm: options.llm });
    const answer = buildAnswerer(new AnswerService({ providers: [exaAnswer], retry: retryConfig }), cache);

    let disposed = false;
    return {
        config,
        content,
        search,
        fetch,
        summarize,
        answer,
        async dispose() {
            if (disposed) return;
            disposed = true;
            content.close();
            await impers.close();
        },
    };
}
