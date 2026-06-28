/**
 * HTML content extraction pipeline: parse, strip noise, score the main content
 * node, and convert it to markdown with harvested link/image/code assets.
 *
 * Algorithm and heuristics ported to TypeScript from webclaw
 * (https://github.com/0xMassi/webclaw, MIT License, (c) 0xMassi). Implemented
 * here over linkedom instead of Rust's `scraper`.
 */

import { collapseWhitespace, stripMarkdown } from './cleanup.js';
import { parseDocument, tagName } from './dom.js';
import { nodeToMd } from './markdown.js';
import { findBestNode } from './score.js';
import type { ExtractedAssets, ExtractionOptions, ExtractionResult } from './types.js';

const MAX_SELECTORS = 100;
const MAIN_CONTENT_SELECTOR = "article, main, [role='main']";

export function extractContent(
    html: string,
    baseUrl: string | undefined,
    options: ExtractionOptions = {},
): ExtractionResult {
    const doc = parseDocument(html);
    const exclude = buildExcludeSet(doc, options.excludeSelectors ?? []);

    // Path 1: explicit include selectors — extract matching elements verbatim.
    if (options.includeSelectors && options.includeSelectors.length > 0) {
        return convertElements(collectIncluded(doc, options.includeSelectors), baseUrl, exclude);
    }

    // Path 2: only_main_content — first article/main/[role=main].
    if (options.onlyMainContent) {
        const main = doc.querySelector(MAIN_CONTENT_SELECTOR);
        if (main) return convertElements([main], baseUrl, exclude);
    }

    // Path 3: scoring. Fall back to <body>, then the document element.
    const best = findBestNode(doc) ?? doc.body ?? doc.documentElement;
    return convertElements(best ? [best] : [], baseUrl, exclude);
}

function convertElements(
    elements: readonly Element[],
    baseUrl: string | undefined,
    exclude: ReadonlySet<Element>,
): ExtractionResult {
    const assets: ExtractedAssets = { links: [], images: [], codeBlocks: [] };
    let md = '';
    for (const el of elements) {
        md += nodeToMd(el, { baseUrl, assets, exclude }, 0, 0);
    }
    const markdown = collapseWhitespace(md);
    const plainText = collapseWhitespace(stripMarkdown(md));
    return { markdown, plainText, assets };
}

function buildExcludeSet(doc: Document, selectors: readonly string[]): Set<Element> {
    const exclude = new Set<Element>();
    for (const selector of selectors.slice(0, MAX_SELECTORS)) {
        let matches: NodeListOf<Element>;
        try {
            matches = doc.querySelectorAll(selector);
        } catch {
            continue; // invalid selector, skip
        }
        for (const el of matches) {
            exclude.add(el);
            for (const desc of el.querySelectorAll('*')) exclude.add(desc);
        }
    }
    return exclude;
}

function collectIncluded(doc: Document, selectors: readonly string[]): Element[] {
    const out: Element[] = [];
    for (const selector of selectors.slice(0, MAX_SELECTORS)) {
        try {
            out.push(...doc.querySelectorAll(selector));
        } catch {}
    }
    return out;
}

export function extractTitle(doc: Document): string {
    const title = doc.querySelector('title');
    if (title?.textContent) return title.textContent.replace(/\s+/g, ' ').trim();
    const h1 = doc.querySelector('h1');
    return h1?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

export type { ExtractedAssets, ExtractionOptions, ExtractionResult };
export { parseDocument, tagName };
