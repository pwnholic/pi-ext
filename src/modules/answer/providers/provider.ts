import type { Result } from '../../../core/result.js';
import type { AnswerQuery, AnswerResponse } from '../answer.types.js';

/**
 * A Q&A backend. Providers are stateless and interchangeable; the service
 * picks the first available one and falls back on failure.
 */
export interface AnswerProvider {
    readonly name: string;
    isAvailable(): boolean;
    answer(query: AnswerQuery, signal?: AbortSignal): Promise<Result<AnswerResponse>>;
}
