/**
 * Timeout + abort helpers. Exa SDK doesn't accept an AbortSignal parameter,
 * so we race the promise against a timeout signal and convert the resulting
 * AbortError into a timeout.
 */

/**
 * Race a promise against an abort signal. If the signal fires before the
 * promise settles, the promise is rejected with an AbortError.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        return Promise.reject(signal.reason ?? new Error('Aborted'));
    }
    return new Promise<T>((resolve, reject) => {
        signal.addEventListener(
            'abort',
            () => {
                reject(signal.reason ?? new Error('Aborted'));
            },
            { once: true },
        );
        promise.then(resolve, reject);
    });
}

/**
 * Create an AbortSignal that fires after `timeoutMs`, linked to an optional
 * parent signal. If the parent is already aborted, the returned signal is too.
 * The timer is cleaned up on abort to avoid keeping the event loop alive.
 */
export function withTimeout(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
    if (parent?.aborted) return parent;

    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(new DOMException('Timeout', 'TimeoutError')),
        timeoutMs,
    );

    if (parent) {
        parent.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                controller.abort(parent.reason);
            },
            { once: true },
        );
    }

    controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });

    return controller.signal;
}

/** Check if an error is a timeout (AbortError with reason 'TimeoutError'). */
export function isTimeoutError(cause: unknown): boolean {
    if (cause instanceof Error) {
        return (
            cause.name === 'TimeoutError' ||
            (cause.name === 'AbortError' && cause.message === 'Timeout')
        );
    }
    return false;
}
