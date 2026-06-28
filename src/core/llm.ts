import type { Result } from './result.js';

export type Role = 'system' | 'user' | 'assistant';

export interface Message {
    readonly role: Role;
    readonly content: string;
}

export interface CompletionRequest {
    readonly messages: readonly Message[];
    readonly temperature?: number;
    readonly maxTokens?: number;
    /** Provider-specific model id; falls back to the client's default. */
    readonly model?: string;
}

/**
 * Minimal LLM abstraction (port). In a Pi extension this is backed by Pi's own
 * model access, so summarization needs no separate API key. When no client is
 * wired, dependent features degrade gracefully instead of failing.
 */
export interface LlmClient {
    readonly name: string;
    isAvailable(): boolean;
    complete(request: CompletionRequest, signal?: AbortSignal): Promise<Result<string>>;
}
