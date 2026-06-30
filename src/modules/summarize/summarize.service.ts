import { appError } from '../../core/errors.js';
import type { LlmClient, Message } from '../../core/llm.js';
import { err, ok, type Result } from '../../core/result.js';
import { type ChunkConfig, chunkText, DEFAULT_CHUNK } from './chunk.js';
import { stripThinkingTags } from './clean.js';
import { buildMapPrompt, buildReducePrompt, buildSummaryPrompt } from './prompt.js';
import type { SummarizeOptions, SummaryResult, SummaryStyle } from './summarize.types.js';

/** Capability interface so the telemetry decorator can wrap the service. */
export interface Summarizer {
    isAvailable(): boolean;
    summarize(
        content: string,
        options?: SummarizeOptions,
        signal?: AbortSignal,
    ): Promise<Result<SummaryResult>>;
}

export interface SummarizeServiceDeps {
    /** Optional: when absent, summarization reports provider_unavailable. */
    readonly llm: LlmClient | undefined;
    readonly chunkConfig?: ChunkConfig;
}

const DEFAULT_SENTENCES = 3;
const TEMPERATURE = 0.3;
/** Cap reduce passes so a pathological input cannot loop forever. */
const MAX_REDUCE_PASSES = 3;

/**
 * LLM-powered summarization with map-reduce over long inputs. Single-shot for
 * short content; for long content each chunk is condensed (map) then merged
 * (reduce), recursing until the combined partials fit a single call.
 */
export class SummarizeService implements Summarizer {
    private readonly llm: LlmClient | undefined;
    private readonly chunkConfig: ChunkConfig;

    constructor(deps: SummarizeServiceDeps) {
        this.llm = deps.llm;
        this.chunkConfig = deps.chunkConfig ?? DEFAULT_CHUNK;
    }

    isAvailable(): boolean {
        return this.llm?.isAvailable() ?? false;
    }

    async summarize(
        content: string,
        options: SummarizeOptions = {},
        signal?: AbortSignal,
    ): Promise<Result<SummaryResult>> {
        const startedAt = Date.now();
        const inputChars = content.length;

        if (!this.llm?.isAvailable()) {
            return err(
                appError('provider_unavailable', 'No LLM client configured for summarization', {
                    source: 'summarize',
                }),
            );
        }
        const trimmed = content.trim();
        if (trimmed === '') {
            return err(
                appError('invalid_input', 'Nothing to summarize (empty content)', {
                    source: 'summarize',
                }),
            );
        }

        const style: SummaryStyle = options.style ?? 'sentences';
        const n = options.maxSentences ?? DEFAULT_SENTENCES;
        const model = options.model;
        const systemPrompt = options.systemPrompt;

        const chunks = chunkText(trimmed, this.chunkConfig);
        let passes = 1;
        let summaryText: string;

        if (chunks.length <= 1) {
            const r = await this.run(
                buildSummaryPrompt(trimmed, style, n, systemPrompt),
                model,
                signal,
            );
            if (!r.ok) return r;
            summaryText = r.value;
        } else {
            const mapped = await this.mapChunks(chunks, model, signal);
            if (!mapped.ok) return mapped;
            passes = 2;

            // Reduce, recursing if the merged partials are still too long.
            let merged = mapped.value.join('\n\n');
            while (merged.length > this.chunkConfig.maxChars && passes < MAX_REDUCE_PASSES + 1) {
                const reMapped = await this.mapChunks(
                    chunkText(merged, this.chunkConfig),
                    model,
                    signal,
                );
                if (!reMapped.ok) return reMapped;
                merged = reMapped.value.join('\n\n');
                passes += 1;
            }

            const r = await this.run(
                buildReducePrompt(merged, style, n, systemPrompt),
                model,
                signal,
            );
            if (!r.ok) return r;
            summaryText = r.value;
            passes += 1;
        }

        return ok({
            summary: summaryText,
            style,
            passes,
            inputChars,
            tookMs: Date.now() - startedAt,
        });
    }

    private async mapChunks(
        chunks: readonly string[],
        model: string | undefined,
        signal: AbortSignal | undefined,
    ): Promise<Result<string[]>> {
        const out: string[] = [];
        for (const chunk of chunks) {
            if (signal?.aborted) {
                return err(appError('aborted', 'Summarization aborted', { source: 'summarize' }));
            }
            const r = await this.run(buildMapPrompt(chunk), model, signal);
            if (!r.ok) return err(r.error);
            out.push(r.value);
        }
        return ok(out);
    }

    private async run(
        messages: Message[],
        model: string | undefined,
        signal: AbortSignal | undefined,
    ): Promise<Result<string>> {
        if (!this.llm) {
            return err(
                appError('provider_unavailable', 'LLM client unavailable', { source: 'summarize' }),
            );
        }
        const request = { messages, temperature: TEMPERATURE, ...(model ? { model } : {}) };
        const r = await this.llm.complete(request, signal);
        if (!r.ok) return r;
        const cleaned = stripThinkingTags(r.value);
        if (cleaned === '') {
            return err(
                appError('unknown', 'LLM returned an empty summary', { source: 'summarize' }),
            );
        }
        return ok(cleaned);
    }
}
