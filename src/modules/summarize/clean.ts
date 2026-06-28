/**
 * Post-processing for LLM responses: strip chain-of-thought reasoning tags
 * (qwen3 and similar emit `<think>...</think>`). Ported from webclaw's
 * `webclaw-llm/src/clean.rs` (https://github.com/0xMassi/webclaw, MIT, (c) 0xMassi).
 */
export function stripThinkingTags(text: string): string {
    let result = '';
    let remaining = text;

    let start = remaining.indexOf('<think>');
    while (start !== -1) {
        result += remaining.slice(0, start);
        const afterOpen = remaining.slice(start + '<think>'.length);
        const end = afterOpen.indexOf('</think>');
        if (end !== -1) {
            remaining = afterOpen.slice(end + '</think>'.length);
        } else {
            // Unclosed: the model is still "thinking" — discard the rest.
            remaining = '';
        }
        start = remaining.indexOf('<think>');
    }
    result += remaining;

    result = result.replaceAll('</think>', '').replaceAll('/think', '');
    return result.trim();
}
