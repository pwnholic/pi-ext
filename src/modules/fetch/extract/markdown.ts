/**
 * DOM-to-markdown conversion.
 *
 * Ported to TypeScript from webclaw's `webclaw-cor./src/markdown.rs`
 * (https://github.com/0xMassi/webclaw, MIT License, (c) 0xMassi). Per-tag
 * handling, lazy-imag./srcset resolution, fenced code with language detection,
 * layout-vs-data table detection, nested lists, inline-separator heuristics,
 * and the preformatted-text collector follow that implementation.
 */
import { isElement, isText, tagName } from './dom.js';
import { isNoise, isNoiseDescendant } from './noise.js';
import { MAX_DOM_DEPTH } from './types.js';

interface Ctx {
    readonly baseUrl: string | undefined;
}

export function nodeToMd(el: Element, ctx: Ctx, listDepth: number, depth: number): string {
    if (depth > MAX_DOM_DEPTH) return el.textContent ?? '';
    if (isNoise(el) || isNoiseDescendant(el)) return '';

    const tag = tagName(el);
    switch (tag) {
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6':
            return headingToMd(el, ctx, depth, tag);
        case 'p':
            return `\n\n${inlineText(el, ctx, depth)}\n\n`;
        case 'a':
            return anchorToMd(el, ctx, depth);
        case 'img':
            return imageToMd(el, ctx);
        case 'strong':
        case 'b':
            return cellHasBlockContent(el)
                ? childrenToMd(el, ctx, listDepth, depth)
                : `**${inlineText(el, ctx, depth)}**`;
        case 'em':
        case 'i':
            return cellHasBlockContent(el)
                ? childrenToMd(el, ctx, listDepth, depth)
                : `*${inlineText(el, ctx, depth)}*`;
        case 'code': {
            if (isInsidePre(el)) return el.textContent ?? '';
            const text = el.textContent ?? '';
            return text === '' ? '' : `\`${text}\``;
        }
        case 'pre':
            return preToMd(el, depth);
        case 'blockquote': {
            const inner = childrenToMd(el, ctx, listDepth, depth).trim();
            const quoted = inner
                .split('\n')
                .map((line) => `> ${line}`)
                .join('\n');
            return `\n\n${quoted}\n\n`;
        }
        case 'ul':
            return `\n\n${listItems(el, ctx, listDepth, false, depth)}\n\n`;
        case 'ol':
            return `\n\n${listItems(el, ctx, listDepth, true, depth)}\n\n`;
        case 'li':
            return `- ${inlineText(el, ctx, depth)}\n`;
        case 'hr':
            return '\n\n---\n\n';
        case 'br':
            return '\n';
        case 'table':
            return `\n\n${tableToMd(el, ctx, depth)}\n\n`;
        default:
            return childrenToMd(el, ctx, listDepth, depth);
    }
}

/**
 * Render a heading. Heading text is sometimes wrapped in an anchor carrying a
 * noise class (e.g. mdBook's `<a class="header">`), which `inlineText` would
 * drop, leaving a bare `#`. Fall back to the element's raw text content, and
 * skip the heading entirely when there is genuinely no text.
 */
function headingToMd(el: Element, ctx: Ctx, depth: number, tag: string): string {
    const level = Number(tag[1]);
    let text = inlineText(el, ctx, depth).trim();
    if (text === '') text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text === '') return '';
    return `\n\n${'#'.repeat(level)} ${text}\n\n`;
}

function childrenToMd(el: Element, ctx: Ctx, listDepth: number, depth: number): string {
    let out = '';
    for (const child of el.childNodes) {
        if (isElement(child)) {
            const chunk = nodeToMd(child, ctx, listDepth, depth + 1);
            if (chunk !== '' && out !== '' && needsSeparator(out, chunk)) out += ' ';
            out += chunk;
        } else if (isText(child)) {
            const text = child.textContent ?? '';
            if (text !== '' && out !== '' && needsSeparator(out, text)) out += ' ';
            out += text;
        }
    }
    return out;
}

function inlineText(el: Element, ctx: Ctx, depth: number): string {
    let out = '';
    for (const child of el.childNodes) {
        if (isElement(child)) {
            const chunk = nodeToMd(child, ctx, 0, depth + 1);
            if (chunk !== '' && out !== '' && needsSeparator(out, chunk)) out += ' ';
            out += chunk;
        } else if (isText(child)) {
            const text = child.textContent ?? '';
            if (text !== '' && out !== '' && needsSeparator(out, text)) out += ' ';
            out += text;
        }
    }
    return out.split(/\s+/).filter(Boolean).join(' ');
}

function anchorToMd(el: Element, ctx: Ctx, depth: number): string {
    const text = inlineText(el, ctx, depth);
    const hrefAttr = el.getAttribute('href');
    const href = hrefAttr ? resolveUrl(hrefAttr, ctx.baseUrl) : '';
    if (text !== '' && href !== '') return `[${text}](${href})`;
    return text;
}

function imageToMd(el: Element, ctx: Ctx): string {
    const alt = el.getAttribute('alt') ?? '';
    const rawSrc =
        el.getAttribute('src') ??
        el.getAttribute('data-src') ??
        el.getAttribute('data-lazy-src') ??
        el.getAttribute('data-original') ??
        '';

    let src =
        rawSrc.startsWith('data:') || rawSrc.startsWith('blob:')
            ? ''
            : resolveUrl(rawSrc, ctx.baseUrl);
    if (src === '') {
        const best = pickBestSrcset(el.getAttribute('srcset') ?? '');
        src = best ? resolveUrl(best, ctx.baseUrl) : '';
    }

    return src !== '' ? `![${alt}](${src})` : '';
}

function preToMd(el: Element, depth: number): string {
    const codeEl = el.querySelector('code');
    let code: string;
    let lang: string | undefined;
    if (codeEl) {
        lang =
            extractLanguageFromClass(codeEl.getAttribute('class') ?? '') ??
            extractLanguageFromClass(el.getAttribute('class') ?? '');
        code = collectPreformattedText(codeEl, depth);
    } else {
        lang = extractLanguageFromClass(el.getAttribute('class') ?? '');
        code = collectPreformattedText(el, depth);
    }
    code = code.replace(/^\n+/, '').replace(/\n+$/, '');
    return `\n\n\`\`\`${lang ?? ''}\n${code}\n\`\`\`\n\n`;
}

function listItems(
    listEl: Element,
    ctx: Ctx,
    depth: number,
    ordered: boolean,
    domDepth: number,
): string {
    const indent = '  '.repeat(depth);
    let out = '';
    let index = 1;

    for (const child of listEl.children) {
        if (tagName(child) !== 'li') continue;

        const bullet = ordered ? `${index++}.` : '-';
        let inlineParts = '';
        let nestedLists = '';

        for (const liChild of child.childNodes) {
            if (isElement(liChild)) {
                const childTag = tagName(liChild);
                if (childTag === 'ul' || childTag === 'ol') {
                    nestedLists += listItems(
                        liChild,
                        ctx,
                        depth + 1,
                        childTag === 'ol',
                        domDepth + 1,
                    );
                } else {
                    inlineParts += nodeToMd(liChild, ctx, depth, domDepth + 1);
                }
            } else if (isText(liChild)) {
                inlineParts += liChild.textContent ?? '';
            }
        }

        const text = inlineParts.split(/\s+/).filter(Boolean).join(' ');
        out += `${indent}${bullet} ${text}\n`;
        if (nestedLists !== '') out += nestedLists;
    }
    return out.replace(/\n+$/, '');
}

const BLOCK_TAGS = new Set([
    'p',
    'div',
    'ul',
    'ol',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'pre',
    'table',
    'section',
    'article',
    'header',
    'footer',
    'nav',
    'aside',
]);

function cellHasBlockContent(cell: Element): boolean {
    for (const desc of cell.querySelectorAll('*')) {
        if (BLOCK_TAGS.has(tagName(desc))) return true;
    }
    return false;
}

function tableToMd(table: Element, ctx: Ctx, depth: number): string {
    const rawRows: Element[][] = [];
    let hasHeader = false;
    let isLayout = false;

    for (const tr of table.querySelectorAll('tr')) {
        const cells: Element[] = [];
        for (const cell of tr.children) {
            const t = tagName(cell);
            if (t !== 'th' && t !== 'td') continue;
            if (t === 'th') hasHeader = true;
            if (!isLayout && cellHasBlockContent(cell)) isLayout = true;
            cells.push(cell);
        }
        if (cells.length > 0) rawRows.push(cells);
    }

    if (rawRows.length === 0) return '';

    if (isLayout) {
        let out = '';
        for (const row of rawRows) {
            for (const cell of row) {
                const content = childrenToMd(cell, ctx, 0, depth).trim();
                if (content !== '') {
                    if (out !== '') out += '\n\n';
                    out += content;
                }
            }
        }
        return out;
    }

    const rows = rawRows.map((row) => row.map((c) => inlineText(c, ctx, depth)));
    const cols = Math.max(...rows.map((r) => r.length));
    if (cols === 0) return '';
    for (const row of rows) while (row.length < cols) row.push('');

    const header = rows[0] ?? [];
    let out = `| ${header.join(' | ')} |\n`;
    out += `| ${Array.from({ length: cols }, () => '---').join(' | ')} |\n`;
    const start = hasHeader ? 1 : 0;
    for (const row of rows.slice(start)) out += `| ${row.join(' | ')} |\n`;
    return out.replace(/\n+$/, '');
}

function collectPreformattedText(el: Element, depth: number): string {
    if (depth > MAX_DOM_DEPTH) return el.textContent ?? '';
    let out = '';
    for (const child of el.childNodes) {
        if (isText(child)) {
            out += child.textContent ?? '';
        } else if (isElement(child)) {
            const tag = tagName(child);
            if (tag === 'br') {
                out += '\n';
            } else if (tag === 'div' || tag === 'p') {
                if (out !== '' && !out.endsWith('\n')) out += '\n';
                out += collectPreformattedText(child, depth + 1);
                if (!out.endsWith('\n')) out += '\n';
            } else {
                out += collectPreformattedText(child, depth + 1);
            }
        }
    }
    return out;
}

function isInsidePre(el: Element): boolean {
    let node = el.parentElement;
    while (node) {
        if (tagName(node) === 'pre') return true;
        node = node.parentElement;
    }
    return false;
}

// --- separator heuristics ---------------------------------------------------

function needsSeparator(left: string, right: string): boolean {
    const l = left.at(-1) ?? ' ';
    const r = right[0] ?? ' ';
    if (/\s/.test(l) || /\s/.test(r)) return false;
    if (isClosingPunctuation(r)) return false;
    if (isOpeningPunctuation(l)) return false;
    if ((l === '`' || l === ')') && startsWithInlineCodeSuffix(right)) return false;
    return true;
}

function startsWithInlineCodeSuffix(s: string): boolean {
    const trimmed = s.replace(/^[*_]+/, '');
    const first = trimmed[0];
    if (first === undefined) return false;
    if (first === "'" || first === '\u2019') return true;
    if (first !== 's' && first !== 'S') return false;
    const second = trimmed[1];
    if (second === undefined) return true;
    return /\s/.test(second) || isClosingPunctuation(second) || second === '*' || second === '_';
}

function isClosingPunctuation(c: string): boolean {
    return '.,;:!?)]}%\'\u2019"\u201d'.includes(c);
}

function isOpeningPunctuation(c: string): boolean {
    return '([{"\u201c'.includes(c);
}

// --- url + image + language helpers ----------------------------------------

export function resolveUrl(href: string, baseUrl: string | undefined): string {
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
        return href;
    }
    if (baseUrl) {
        try {
            return new URL(href, baseUrl).toString();
        } catch {
            /* fall through */
        }
    }
    return href;
}

function pickBestSrcset(srcset: string): string | undefined {
    let bestUrl: string | undefined;
    let bestSize = 0;
    for (const entry of srcset.split(',')) {
        const parts = entry.trim().split(/\s+/).filter(Boolean);
        const url = parts[0];
        if (!url || url.startsWith('data:') || url.startsWith('blob:')) continue;
        let size = 1;
        if (parts[1]) {
            const digits = parts[1].replace(/[^\d].*$/, '');
            size = digits === '' ? 1 : Number.parseInt(digits, 10);
        }
        if (size > bestSize) {
            bestSize = size;
            bestUrl = url;
        }
    }
    return bestUrl;
}

const KNOWN_LANGS = new Set([
    'javascript',
    'typescript',
    'python',
    'rust',
    'go',
    'java',
    'c',
    'cpp',
    'csharp',
    'ruby',
    'php',
    'swift',
    'kotlin',
    'scala',
    'shell',
    'bash',
    'zsh',
    'fish',
    'sql',
    'html',
    'css',
    'scss',
    'sass',
    'less',
    'json',
    'yaml',
    'yml',
    'toml',
    'xml',
    'markdown',
    'md',
    'jsx',
    'tsx',
    'vue',
    'svelte',
    'graphql',
    'protobuf',
    'dockerfile',
    'makefile',
    'lua',
    'perl',
    'r',
    'matlab',
    'haskell',
    'elixir',
    'erlang',
    'clojure',
]);

function normalizeLang(lang: string): string {
    switch (lang.toLowerCase()) {
        case 'javascript':
        case 'js':
            return 'js';
        case 'typescript':
        case 'ts':
            return 'ts';
        case 'python':
        case 'py':
            return 'python';
        case 'csharp':
        case 'cs':
        case 'c#':
            return 'csharp';
        case 'cpp':
        case 'c++':
            return 'cpp';
        case 'shell':
        case 'bash':
        case 'zsh':
        case 'sh':
            return 'bash';
        case 'yaml':
        case 'yml':
            return 'yaml';
        case 'markdown':
        case 'md':
            return 'markdown';
        case 'plaintext':
        case 'text':
            return 'text';
        default:
            return lang.toLowerCase();
    }
}

function extractLanguageFromClass(classAttr: string): string | undefined {
    for (const cls of classAttr.split(/\s+/).filter(Boolean)) {
        for (const prefix of ['language-', 'lang-', 'highlight-']) {
            if (cls.startsWith(prefix)) {
                const lang = cls.slice(prefix.length);
                if (lang !== '' && lang.length < 20) return normalizeLang(lang);
            }
        }
        if (cls.startsWith('sp-')) {
            const lower = cls.slice(3).toLowerCase();
            if (KNOWN_LANGS.has(lower)) return normalizeLang(lower);
        }
        const lower = cls.toLowerCase();
        if (KNOWN_LANGS.has(lower)) return normalizeLang(lower);
    }
    return undefined;
}
