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
    const md = extractContent(PAGE, 'https://example.com/blog/');

    it('selects the article and drops nav/sidebar/footer/cookie noise', () => {
        expect(md).toContain('# Hello World');
        expect(md).toContain('main');
        expect(md).not.toContain('Home');
        expect(md).not.toContain('Buy now');
        expect(md).not.toContain('We use cookies');
        expect(md).not.toContain('Copyright');
    });

    it('converts structure: headings, bold, lists, fenced code', () => {
        expect(md).toContain('**main**');
        expect(md).toContain('- One');
        expect(md).toContain('\n  - Nested');
        expect(md).toContain('```ts\nconst x: number = 1;\n```');
    });

    it('resolves relative URLs against the base', () => {
        expect(md).toContain('[link](https://example.com/docs)');
        expect(md).toContain('![a picture](https://example.com/img/pic.png)');
    });

    it('extracts and normalizes the title', () => {
        expect(extractTitle(parseDocument(PAGE))).toBe('My Article');
    });
});
