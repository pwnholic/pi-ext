/**
 * Result is a discriminated union for explicit success/failure handling.
 * Services and providers return Result instead of throwing for expected
 * failures; thrown errors are reserved for programmer bugs.
 */
export type Result<T, E = AppError> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E };

import type { AppError } from './errors.js';

export function ok<T>(value: T): Result<T, never> {
    return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
    return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
    return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
    return !r.ok;
}

export function map<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
    return r.ok ? ok(fn(r.value)) : r;
}

export async function fromPromise<T>(
    promise: Promise<T>,
    onError: (cause: unknown) => AppError,
): Promise<Result<T>> {
    try {
        return ok(await promise);
    } catch (cause) {
        return err(onError(cause));
    }
}
