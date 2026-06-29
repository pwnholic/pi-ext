import { describe, expect, it } from 'vitest';
import type { CompletionRequest, LlmClient } from '../src/core/llm.js';
import { ok, type Result } from '../src/core/result.js';
import { chunkText } from '../src/modules/summarize/chunk.js';
import { stripThinkingTags } from '../src/modules/summarize/clean.js';
import { SummarizeService } from '../src/modules/summarize/summarize.service.js';

function fakeLlm(handler: (req: CompletionRequest) => string): LlmClient {
    return {
        name: 'fake',
        isAvailable: () => true,
        complete: (req): Promise<Result<string>> => Promise.resolve(ok(handler(req))),
    };
}

function makeService(llm: LlmClient | undefined): SummarizeService {
    return new SummarizeService({
        llm,
        chunkConfig: { maxChars: 100, overlapChars: 10 },
    });
}

describe('stripThinkingTags', () => {
    it('removes think blocks and orphan fragments', () => {
        expect(stripThinkingTags('<think>reasoning</think>answer')).toBe('answer');
        expect(stripThinkingTags('a<think>x</think>b<think>y</think>c')).toBe('abc');
        expect(stripThinkingTags('good<think>still going...')).toBe('good');
        expect(stripThinkingTags('text</think> more')).toBe('text more');
    });
});

describe('chunkText', () => {
    it('keeps short text as one chunk', () => {
        expect(chunkText('hello', { maxChars: 100, overlapChars: 10 })).toEqual(['hello']);
    });
    it('splits long text on paragraph boundaries', () => {
        const text = ['a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60)].join('\n\n');
        const chunks = chunkText(text, { maxChars: 100, overlapChars: 10 });
        expect(chunks.length).toBeGreaterThan(1);
    });
});

describe('SummarizeService', () => {
    it('reports unavailable without an LLM client', async () => {
        const r = await makeService(undefined).summarize('anything');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.kind).toBe('provider_unavailable');
    });

    it('single-shot for short content and strips thinking tags', async () => {
        const llm = fakeLlm(() => '<think>hmm</think>A short summary.');
        const r = await makeService(llm).summarize('a short page');
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.summary).toBe('A short summary.');
            expect(r.value.passes).toBe(1);
        }
    });

    it('map-reduces long content across multiple passes', async () => {
        const calls: string[] = [];
        const llm = fakeLlm((req) => {
            const system = req.messages[0]?.content ?? '';
            calls.push(system.includes('one section') ? 'map' : 'reduce');
            return 'partial';
        });
        const long = Array.from({ length: 6 }, (_, i) => `para ${i} ${'x'.repeat(80)}`).join(
            '\n\n',
        );
        const r = await makeService(llm).summarize(long, { style: 'bullets', maxSentences: 4 });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.passes).toBeGreaterThanOrEqual(2);
            expect(r.value.style).toBe('bullets');
        }
        expect(calls).toContain('map');
        expect(calls).toContain('reduce');
    });
});
