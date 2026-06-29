/**
 * HTML content extraction pipeline: parse, strip noise, score the main content
 * node, and convert it to markdown.
 *
 * Algorithm and heuristics ported to TypeScript from webclaw
 * (https://github.com/0xMassi/webclaw, MIT License, (c) 0xMassi). Implemented
 * here over linkedom instead of Rust's `scraper`.
 */

import { collapseWhitespace } from './cleanup.js';
import { parseDocument } from './dom.js';
import { nodeToMd } from './markdown.js';
import { findBestNode } from './score.js';

/**
 * Extract readable markdown from an HTML document. Runs the full pipeline:
 * parse → find best content node (readability scoring) → convert to markdown
 * → collapse whitespace.
 */
export function extractContent(html: string, baseUrl: string | undefined): string {
    const doc = parseDocument(html);
    const best = findBestNode(doc) ?? doc.body ?? doc.documentElement;
    if (!best) return '';
    const md = nodeToMd(best, { baseUrl }, 0, 0);
    return collapseWhitespace(md);
}

export function extractTitle(doc: Document): string {
    const title = doc.querySelector('title');
    if (title?.textContent) return title.textContent.replace(/\s+/g, ' ').trim();
    const h1 = doc.querySelector('h1');
    return h1?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

export { parseDocument, tagName } from './dom.js';
