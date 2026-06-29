/**
 * Prompt construction. The single-shot instruction follows webclaw's
 * `summarize.rs` ("summarization engine, exactly N sentences, output only the
 * summary"), extended here with a bullets style and dedicated map/reduce
 * prompts for chunked long-document summarization.
 */
import type { Message } from '../../core/llm.js';
import type { SummaryStyle } from './summarize.types.js';

function styleInstruction(style: SummaryStyle, n: number): string {
    return style === 'bullets'
        ? `Summarize the following content as exactly ${n} concise bullet points, one fact per line, each starting with "- ".`
        : `Summarize the following content in exactly ${n} sentences.`;
}

const OUTPUT_ONLY =
    'Output ONLY the summary, nothing else. No introductions, no questions, no preamble, no meta commentary.';

/** Final/single-pass summary prompt. */
export function buildSummaryPrompt(content: string, style: SummaryStyle, n: number): Message[] {
    return [
        {
            role: 'system',
            content: `You are a summarization engine. ${styleInstruction(style, n)} ${OUTPUT_ONLY}`,
        },
        { role: 'user', content },
    ];
}

/** Map step: condense one chunk of a long document, preserving key facts. */
export function buildMapPrompt(chunk: string): Message[] {
    return [
        {
            role: 'system',
            content:
                'You are a summarization engine condensing one section of a longer document. ' +
                'Capture every distinct key fact, name, number, and claim in dense prose. ' +
                'Do not add commentary or note that this is a partial section. ' +
                OUTPUT_ONLY,
        },
        { role: 'user', content: chunk },
    ];
}

/** Reduce step: merge per-chunk summaries into the final summary. */
export function buildReducePrompt(partials: string, style: SummaryStyle, n: number): Message[] {
    return [
        {
            role: 'system',
            content:
                'You are a summarization engine. The user message contains ordered summaries of ' +
                `consecutive sections of one document. Merge them into a single coherent summary. ${styleInstruction(style, n)} ${OUTPUT_ONLY}`,
        },
        { role: 'user', content: partials },
    ];
}
