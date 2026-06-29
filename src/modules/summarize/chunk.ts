/**
 * Splitting long documents into overlapping chunks for map-reduce
 * summarization. This is the main improvement over webclaw's summarizer, which
 * sends the entire document in a single call and breaks on long pages.
 *
 * Splits on paragraph boundaries where possible, falling back to hard slicing
 * for pathological single-paragraph inputs. A small overlap preserves context
 * across chunk seams.
 */
export interface ChunkConfig {
    readonly maxChars: number;
    readonly overlapChars: number;
}

export const DEFAULT_CHUNK: ChunkConfig = {
    maxChars: 12_000,
    overlapChars: 400,
};

export function chunkText(text: string, config: ChunkConfig = DEFAULT_CHUNK): string[] {
    const trimmed = text.trim();
    if (trimmed.length <= config.maxChars) return trimmed.length === 0 ? [] : [trimmed];

    const paragraphs = trimmed.split(/\n{2,}/);
    const chunks: string[] = [];
    let current = '';

    const flush = (): void => {
        if (current.trim() !== '') chunks.push(current.trim());
        // Carry an overlap tail into the next chunk for cross-seam context.
        current = current.length > config.overlapChars ? current.slice(-config.overlapChars) : '';
    };

    for (const para of paragraphs) {
        if (para.length > config.maxChars) {
            // A single oversized paragraph: hard-slice it.
            flush();
            for (let i = 0; i < para.length; i += config.maxChars) {
                chunks.push(para.slice(i, i + config.maxChars));
            }
            current = '';
            continue;
        }
        if (current !== '' && current.length + para.length + 2 > config.maxChars) flush();
        current += (current === '' ? '' : '\n\n') + para;
    }
    if (current.trim() !== '') chunks.push(current.trim());

    return chunks;
}
