import { describe, expect, it } from 'vitest';
import { extractContent, extractTitle, parseDocument } from '../src/modules/fetch/extract/index.js';

const PAGE = `<!doctype html>
<html>
<head><title>  My  Article  </title></head>
<body>
  <header class="site-header"><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
  <aside class="sidebar"><a href="/ad">Buy now</a></aside>
  <div class="cookie-banner">We use cookies <a href="/policy">policy</a></div>
  <article class="post-content">
    <h1>Hello World</h1>
    <p>This is the <strong>main</strong> content with a <a href="/docs">link</a>.</p>
    <p>Second paragraph that makes the article substantial enough to win scoring over the navigation and sidebar noise blocks present on the page.</p>
    <ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul>
    <pre><code class="language-ts">const x: number = 1;</code></pre>
    <img src="/img/pic.png" alt="a picture">
  </article>
  <footer class="footer">Copyright 2026 <a href="/terms">Terms</a></footer>
</body>
</html>`;

describe('extractContent', () => {
    const result = extractContent(PAGE, 'https://example.com/blog/');

    it('selects the article and drops nav/sidebar/footer/cookie noise', () => {
        expect(result.markdown).toContain('# Hello World');
        expect(result.markdown).toContain('main');
        expect(result.markdown).not.toContain('Home');
        expect(result.markdown).not.toContain('Buy now');
        expect(result.markdown).not.toContain('We use cookies');
        expect(result.markdown).not.toContain('Copyright');
    });

    it('converts structure: headings, bold, lists, fenced code', () => {
        expect(result.markdown).toContain('**main**');
        expect(result.markdown).toContain('- One');
        expect(result.markdown).toContain('\n  - Nested');
        expect(result.markdown).toContain('```ts\nconst x: number = 1;\n```');
    });

    it('resolves relative URLs against the base and harvests assets', () => {
        expect(result.markdown).toContain('[link](https://example.com/docs)');
        expect(result.markdown).toContain('![a picture](https://example.com/img/pic.png)');
        expect(result.assets.links.map((l) => l.href)).toContain('https://example.com/docs');
        expect(result.assets.images[0]?.src).toBe('https://example.com/img/pic.png');
        expect(result.assets.codeBlocks[0]).toEqual({
            language: 'ts',
            code: 'const x: number = 1;',
        });
    });

    it('derives a clean plain-text view without markdown syntax', () => {
        expect(result.plainText).toContain('Hello World');
        expect(result.plainText).not.toContain('# Hello World');
        expect(result.plainText).not.toContain('](');
    });

    it('extracts and normalizes the title', () => {
        expect(extractTitle(parseDocument(PAGE))).toBe('My Article');
    });
});
