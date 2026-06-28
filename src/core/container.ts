import { type Fetcher, FetchService } from '../modules/fetch/fetch.service.js';
import { ImpersFetchProvider } from '../modules/fetch/providers/impers.provider.js';
import { ExaSearchProvider } from '../modules/search/providers/exa.provider.js';
import { type Searcher, SearchService } from '../modules/search/search.service.js';
import { type Summarizer, SummarizeService } from '../modules/summarize/summarize.service.js';
import { ActivityMonitor } from './activity-monitor.js';
import { type AppConfig, loadConfigFile, resolveConfig } from './config.js';
import { type ContentStore, InMemoryContentStore } from './content-store.js';
import type { Instrumentation } from './instrument.js';
import type { LlmClient } from './llm.js';
import { createLogger, type Logger } from './logger.js';
import { buildFetcher, buildSearcher, buildSummarizer } from './pipeline.js';
import { SqliteContentStore } from './sqlite-content-store.js';
import { type CacheStore, InMemoryStore } from './store.js';

/**
 * Composition root. Constructs providers and base services, then wraps them
 * with the read-through cache and telemetry decorators. This is the only place
 * objects are wired, so the dependency graph is visible in one file.
 */
export interface Container {
    readonly config: AppConfig;
    readonly logger: Logger;
    readonly activity: ActivityMonitor;
    readonly content: ContentStore;
    readonly search: Searcher;
    readonly fetch: Fetcher;
    readonly summarize: Summarizer;
    dispose(): Promise<void>;
}

export interface ContainerOptions {
    readonly config?: Partial<AppConfig>;
    /** Pi-backed LLM client; when omitted, summarization is unavailable. */
    readonly llm?: LlmClient;
}

/** Build the content store, preferring SQLite/FTS5 with a graceful fallback. */
function createContentStore(config: AppConfig, logger: Logger): ContentStore {
    if (config.content.fts) {
        try {
            return new SqliteContentStore({ maxResponses: config.content.maxResponses });
        } catch (error) {
            logger.warn('sqlite content store unavailable, using in-memory', {
                error: String(error),
            });
        }
    }
    return new InMemoryContentStore({ maxResponses: config.content.maxResponses });
}

export function createContainer(options: ContainerOptions = {}): Container {
    const fileConfig = options.config ?? loadConfigFile(process.env);
    const config = resolveConfig(process.env, fileConfig);
    const logger = createLogger(config.logLevel, { app: 'pi-ext' });

    const exa = new ExaSearchProvider(config);
    const impers = new ImpersFetchProvider(config);

    const activity = new ActivityMonitor();
    const content = createContentStore(config, logger);
    const inst: Instrumentation = { monitor: activity, logger };
    const cache: CacheStore | undefined = config.cache.enabled
        ? new InMemoryStore({ ttlMs: config.cache.ttlMs, maxEntries: config.cache.maxEntries })
        : undefined;

    const search = buildSearcher(new SearchService({ logger, providers: [exa] }), inst, cache);
    const fetch = buildFetcher(new FetchService({ logger, providers: [impers] }), inst, cache);
    const summarize = buildSummarizer(new SummarizeService({ logger, llm: options.llm }), inst);

    return {
        config,
        logger,
        activity,
        content,
        search,
        fetch,
        summarize,
        async dispose() {
            activity.clear();
            content.close();
            await impers.close();
        },
    };
}
