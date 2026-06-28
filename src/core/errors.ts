/**
 * Error taxonomy. Every recoverable failure in the system is one of these
 * codes so subscribers and tools can branch on `kind` instead of parsing
 * message strings.
 */
export type ErrorKind =
    | 'config'
    | 'network'
    | 'timeout'
    | 'aborted'
    | 'blocked'
    | 'not_found'
    | 'provider_unavailable'
    | 'no_provider'
    | 'invalid_input'
    | 'unknown';

export interface AppError {
    readonly kind: ErrorKind;
    readonly message: string;
    readonly retryable: boolean;
    readonly cause?: unknown;
    /** Provider or module that produced the error, for diagnostics. */
    readonly source?: string;
}

export function appError(
    kind: ErrorKind,
    message: string,
    options: { retryable?: boolean; cause?: unknown; source?: string } = {},
): AppError {
    return {
        kind,
        message,
        retryable: options.retryable ?? defaultRetryable(kind),
        ...(options.cause !== undefined ? { cause: options.cause } : {}),
        ...(options.source !== undefined ? { source: options.source } : {}),
    };
}

export function isAbort(error: AppError): boolean {
    return error.kind === 'aborted';
}

export function toError(cause: unknown, source?: string): AppError {
    if (cause instanceof Error && cause.name === 'AbortError') {
        return appError('aborted', 'Operation aborted', {
            cause,
            ...(source ? { source } : {}),
        });
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    return appError('unknown', message, { cause, ...(source ? { source } : {}) });
}

function defaultRetryable(kind: ErrorKind): boolean {
    return kind === 'network' || kind === 'timeout' || kind === 'provider_unavailable';
}
