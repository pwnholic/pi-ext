/**
 * Readability-style node scoring.
 *
 * Ported to TypeScript from webclaw's `webclaw-cor./src/extractor.rs`
 * (https://github.com/0xMassi/webclaw, MIT License, (c) 0xMassi). Weights,
 * the log-scaled text base, paragraph bonus, and the link-density penalties
 * (milder for semantic nodes) follow that implementation.
 */
import { tagName } from './dom.js';
import { isNoise, isNoiseDescendant } from './noise.js';

const CANDIDATE_SELECTOR = "article, main, [role='main'], div, section, td";
const MIN_CONTENT_CHARS = 50;

export function scoreNode(el: Element): number {
    const text = el.textContent ?? '';
    const textLen = text.length;
    if (textLen < MIN_CONTENT_CHARS) return 0;

    let score = Math.log(textLen);

    const tag = tagName(el);
    if (tag === 'article' || tag === 'main') score += 50;
    if (el.getAttribute('role') === 'main') score += 50;

    const cls = el.getAttribute('class')?.toLowerCase();
    if (
        cls &&
        (cls.includes('content') ||
            cls.includes('article') ||
            cls.includes('post') ||
            cls.includes('entry'))
    ) {
        score += 25;
    }
    const id = el.getAttribute('id')?.toLowerCase();
    if (
        id &&
        (id.includes('content') ||
            id.includes('article') ||
            id.includes('post') ||
            id.includes('main'))
    ) {
        score += 25;
    }

    const pCount = el.querySelectorAll('p').length;
    score += pCount * 3;

    let linkTextLen = 0;
    for (const a of el.querySelectorAll('a')) {
        linkTextLen += (a.textContent ?? '').length;
    }

    const isSemantic = tag === 'article' || tag === 'main' || el.getAttribute('role') === 'main';
    if (textLen > 0) {
        const linkDensity = linkTextLen / textLen;
        if (isSemantic) {
            if (linkDensity > 0.7) score *= 0.3;
            else if (linkDensity > 0.5) score *= 0.5;
        } else {
            if (linkDensity > 0.5) score *= 0.1;
            else if (linkDensity > 0.3) score *= 0.5;
        }
    }

    return score;
}

export function findBestNode(doc: Document): Element | undefined {
    let best: { el: Element; score: number } | undefined;
    for (const candidate of doc.querySelectorAll(CANDIDATE_SELECTOR)) {
        if (isNoise(candidate) || isNoiseDescendant(candidate)) continue;
        const score = scoreNode(candidate);
        if (score > 0 && (!best || score > best.score)) {
            best = { el: candidate, score };
        }
    }
    return best?.el;
}
