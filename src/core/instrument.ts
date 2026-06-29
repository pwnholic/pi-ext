import type { ActivityKind, ActivityMonitor } from './activity-monitor.js';
import { ok, type Result } from './result.js';
import type { CacheStore } from './store.js';

export interface Instrumentation {
    readonly monitor: ActivityMonitor;
}

/**
 * Cross-cutting telemetry decorator: wraps a labeled async Result operation
 * with activity tracking. Replaces the event-bus subscribers with an
 * explicit, ordered, type-safe call.
 */
export async function instrument<T>(
    inst: Instrumentation,
    kind: ActivityKind,
    label: string,
    describe: (_value: T) => string,
    op: () => Promise<Result<T>>,
): Promise<Result<T>> {
    const id = crypto.randomUUID();
    inst.monitor.start(id, kind, label);

    const result = await op();

    if (result.ok) {
        inst.monitor.end(id);
    } else {
        inst.monitor.end(id);
    }
    return result;
}

/**
 * Read-through cache decorator: serve a fresh hit, otherwise run `op` and store
 * the value on success. A missing store disables caching transparently.
 */
export async function readThrough<T>(
    store: CacheStore | undefined,
    key: string,
    op: () => Promise<Result<T>>,
): Promise<Result<T>> {
    if (store) {
        const hit = store.get<T>(key);
        if (hit !== undefined) return ok(hit);
    }
    const result = await op();
    if (store && result.ok) store.set(key, result.value);
    return result;
}
