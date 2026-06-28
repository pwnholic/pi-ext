/**
 * Cache abstraction (port). A bounded key/value store with per-entry TTL.
 * The in-memory implementation lives here; a persistent SQLite-backed adapter
 * can implement the same interface without touching callers.
 */
export interface CacheStore {
    get<T>(key: string): T | undefined;
    set<T>(key: string, value: T): void;
    clear(): void;
}

interface Entry {
    readonly value: unknown;
    readonly expiresAt: number;
}

export interface InMemoryStoreConfig {
    readonly ttlMs: number;
    readonly maxEntries: number;
}

/**
 * Bounded TTL + LRU in-memory cache. Reads evict expired entries lazily and
 * mark hits as most-recently-used; writes drop the oldest entry past the cap.
 */
export class InMemoryStore implements CacheStore {
    private readonly entries = new Map<string, Entry>();

    constructor(private readonly config: InMemoryStoreConfig) {}

    get<T>(key: string): T | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= Date.now()) {
            this.entries.delete(key);
            return undefined;
        }
        // LRU touch: re-insert so iteration order tracks recency.
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value as T;
    }

    set<T>(key: string, value: T): void {
        if (!this.entries.has(key) && this.entries.size >= this.config.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined) this.entries.delete(oldest);
        }
        this.entries.set(key, { value, expiresAt: Date.now() + this.config.ttlMs });
    }

    clear(): void {
        this.entries.clear();
    }
}
