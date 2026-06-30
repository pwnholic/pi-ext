/**
 * Prompt construction. The single-shot instruction follows webclaw's
 * `summarize.rs` ("summarization engine, exactly N sentences, output only the
 * summary"), extended here with a bullets style, dedicated map/reduce prompts
 * for chunked long-document summarization, and a caller-supplied focus
 * instruction (`systemPrompt`) that overrides the generic default.
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

/** The caller's focus instruction, or the generic default when none is given. */
function focusInstruction(
    systemPrompt: string | undefined,
    style: SummaryStyle,
    n: number,
): string {
    const custom = systemPrompt?.trim();
    if (custom) {
        return `${custom} ${styleInstruction(style, n)}`;
    }
    return styleInstruction(style, n);
}

/** Final/single-pass summary prompt. */
export function buildSummaryPrompt(
    content: string,
    style: SummaryStyle,
    n: number,
    systemPrompt?: string,
): Message[] {
    return [
        {
            role: 'system',
            content: `You are a summarization engine. ${focusInstruction(systemPrompt, style, n)} ${OUTPUT_ONLY}`,
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
export function buildReducePrompt(
    partials: string,
    style: SummaryStyle,
    n: number,
    systemPrompt?: string,
): Message[] {
    return [
        {
            role: 'system',
            content:
                'You are a summarization engine. The user message contains ordered summaries of ' +
                `consecutive sections of one document. Merge them into a single coherent summary. ${focusInstruction(systemPrompt, style, n)} ${OUTPUT_ONLY}`,
        },
        { role: 'user', content: partials },
    ];
}
