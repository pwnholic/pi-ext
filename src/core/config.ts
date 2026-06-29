import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolved, validated configuration. Loaded once at composition time.
 * Precedence: environment variables override the JSON config file, which
 * overrides built-in defaults.
 */
export interface AppConfig {
    readonly search: {
        readonly exaApiKey: string | undefined;
        readonly defaultNumResults: number;
        readonly timeoutMs: number;
    };
    readonly fetch: {
        /** curl-impersonate target, e.g. "chrome", "safari", "firefox". */
        readonly impersonate: string;
        readonly timeoutMs: number;
        readonly maxConcurrent: number;
        readonly proxy: string | undefined;
    };
    readonly retry: {
        readonly maxRetries: number;
        readonly baseDelayMs: number;
        readonly maxDelayMs: number;
    };
    readonly cache: {
        readonly enabled: boolean;
        readonly ttlMs: number;
        readonly maxEntries: number;
    };
    readonly content: {
        /** Pages with content at/below this size are returned inline. */
        readonly inlineMaxChars: number;
        /** Sections larger than this are chunked for addressability. */
        readonly maxSectionChars: number;
        /** Bound on retained responses (session-scoped). */
        readonly maxResponses: number;
        /** Use the SQLite/FTS5 backend (off-heap + ranked search). */
        readonly fts: boolean;
    };
}

export const DEFAULT_CONFIG: AppConfig = {
    search: {
        exaApiKey: undefined,
        defaultNumResults: 5,
        timeoutMs: 20_000,
    },
    fetch: {
        impersonate: 'chrome',
        timeoutMs: 30_000,
        maxConcurrent: 3,
        proxy: undefined,
    },
    cache: {
        enabled: true,
        ttlMs: 5 * 60_000,
        maxEntries: 256,
    },
    retry: {
        maxRetries: 2,
        baseDelayMs: 300,
        maxDelayMs: 3_000,
    },
    content: {
        inlineMaxChars: 6_000,
        maxSectionChars: 4_000,
        maxResponses: 50,
        fts: true,
    },
};

/**
 * Build the effective config: defaults < config file < environment variables.
 * Pure except for reading `env`; the file read is done by `loadConfigFile` and
 * passed in as `fileConfig`, keeping this function testable.
 */
export function resolveConfig(
    env: NodeJS.ProcessEnv = process.env,
    fileConfig: Partial<AppConfig> = {},
): AppConfig {
    const merged: AppConfig = {
        search: { ...DEFAULT_CONFIG.search, ...fileConfig.search },
        fetch: { ...DEFAULT_CONFIG.fetch, ...fileConfig.fetch },
        retry: { ...DEFAULT_CONFIG.retry, ...fileConfig.retry },
        cache: { ...DEFAULT_CONFIG.cache, ...fileConfig.cache },
        content: { ...DEFAULT_CONFIG.content, ...fileConfig.content },
    };
    return applyEnv(merged, env);
}

function applyEnv(config: AppConfig, env: NodeJS.ProcessEnv): AppConfig {
    const exaApiKey = env.EXA_API_KEY?.trim();
    const proxy = env.IMPERS_PROXY?.trim();
    const impersonate = env.IMPERS_IMPERSONATE?.trim();
    return {
        ...config,
        search: { ...config.search, ...(exaApiKey ? { exaApiKey } : {}) },
        fetch: {
            ...config.fetch,
            ...(proxy ? { proxy } : {}),
            ...(impersonate ? { impersonate } : {}),
        },
    };
}

/**
 * Read the JSON config file from `$PI_CODING_AGENT_DIR` or `~/.pi` (the Pi
 * config directory). Missing or malformed files yield an empty partial
 * (defaults win).
 */
export function loadConfigFile(env: NodeJS.ProcessEnv = process.env): Partial<AppConfig> {
    const dir = env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi');
    try {
        return JSON.parse(readFileSync(join(dir, 'web-access.json'), 'utf8')) as Partial<AppConfig>;
    } catch {
        return {};
    }
}
