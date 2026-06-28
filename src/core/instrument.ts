import type { ActivityKind, ActivityMonitor } from './activity-monitor.js';
import type { Logger } from './logger.js';
import { ok, type Result } from './result.js';
import type { CacheStore } from './store.js';

export interface Instrumentation {
    readonly monitor: ActivityMonitor;
    readonly logger: Logger;
}

/**
 * Cross-cutting telemetry decorator: wraps a labeled async Result operation
 * with activity tracking and structured logging. Replaces the event-bus
 * subscribers with an explicit, ordered, type-safe call.
 */
export async function instrument<T>(
    inst: Instrumentation,
    kind: ActivityKind,
    label: string,
    describe: (value: T) => string,
    op: () => Promise<Result<T>>,
): Promise<Result<T>> {
    const id = crypto.randomUUID();
    inst.monitor.start(id, kind, label);
    inst.logger.info(`${kind}.start`, { id, label });

    const result = await op();

    if (result.ok) {
        const detail = describe(result.value);
        inst.monitor.end(id, 'ok', detail);
        inst.logger.info(`${kind}.ok`, { id, detail });
    } else {
        inst.monitor.end(id, 'error', result.error.message);
        inst.logger.warn(`${kind}.failed`, { id, error: result.error.message });
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
