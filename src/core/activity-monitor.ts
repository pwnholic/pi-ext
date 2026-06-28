export type Unsubscribe = () => void;

export type ActivityKind = 'search' | 'fetch' | 'summarize';

export interface ActivityEntry {
    readonly id: string;
    readonly kind: ActivityKind;
    readonly label: string;
    readonly status: 'running' | 'ok' | 'error';
    readonly startedAt: number;
    endedAt?: number;
    detail?: string;
}

export type ActivityListener = (entries: readonly ActivityEntry[]) => void;

/**
 * In-memory activity ledger. Instrumentation calls `start`/`end` directly
 * (no event bus); UI consumers subscribe via `onUpdate` to render a live
 * monitor. Knows nothing about the UI — it only tracks state and notifies.
 */
export class ActivityMonitor {
    private readonly entries = new Map<string, ActivityEntry>();
    private readonly listeners = new Set<ActivityListener>();

    onUpdate(listener: ActivityListener): Unsubscribe {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    snapshot(): readonly ActivityEntry[] {
        return [...this.entries.values()].sort((a, b) => a.startedAt - b.startedAt);
    }

    start(id: string, kind: ActivityKind, label: string): void {
        this.entries.set(id, { id, kind, label, status: 'running', startedAt: Date.now() });
        this.notify();
    }

    end(id: string, status: 'ok' | 'error', detail: string): void {
        const entry = this.entries.get(id);
        if (!entry) return;
        this.entries.set(id, { ...entry, status, detail, endedAt: Date.now() });
        this.notify();
    }

    clear(): void {
        this.entries.clear();
        this.notify();
    }

    private notify(): void {
        const snap = this.snapshot();
        for (const listener of this.listeners) listener(snap);
    }
}
