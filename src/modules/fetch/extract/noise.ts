/**
 * Boilerplate / noise detection.
 *
 * Ported to TypeScript from webclaw's `webclaw-cor./src/noise.rs`
 * (https://github.com/0xMassi/webclaw, MIT License, (c) 0xMassi). The pattern
 * tables, exact-token matching, form/ad heuristics, the 5000-char safety valve,
 * and cookie-consent prefixes follow that implementation.
 */
import { tagName } from './dom.js';

const NOISE_TAGS = new Set([
    'script',
    'style',
    'noscript',
    'iframe',
    'svg',
    'nav',
    'aside',
    'footer',
    'header',
    'video',
    'audio',
    'canvas',
]);

const NOISE_ROLES = new Set(['navigation', 'banner', 'complementary', 'contentinfo']);

const NOISE_CLASSES = new Set([
    'header',
    'top',
    'navbar',
    'footer',
    'bottom',
    'sidebar',
    'modal',
    'popup',
    'overlay',
    'ad',
    'ads',
    'advert',
    'lang-selector',
    'language',
    'social',
    'social-media',
    'social-links',
    'menu',
    'navigation',
    'breadcrumbs',
    'breadcrumb',
    'share',
    'widget',
    'cookie',
    'newsletter',
    'subscribe',
    'skip-link',
    'sr-only',
    'visually-hidden',
    'notification',
    'alert',
    'toast',
    'pagination',
    'pager',
    'signup',
    'login-form',
    'search-form',
    'related-posts',
    'recommended',
]);

const NOISE_IDS = new Set([
    'header',
    'footer',
    'nav',
    'sidebar',
    'menu',
    'modal',
    'popup',
    'cookie',
    'breadcrumbs',
    'widget',
    'ad',
    'social',
    'share',
    'newsletter',
    'subscribe',
    'comments',
    'related',
    'recommended',
]);

const COOKIE_CONSENT_PREFIXES = [
    'onetrust',
    'optanon',
    'ot-sdk',
    'cookiebot',
    'cybotcookiebot',
    'cc-',
    'cookie-law',
    'gdpr',
    'consent-',
    'cmp-',
    'sp_message',
    'qc-cmp',
    'trustarc',
    'evidon',
];

const STRUCTURAL_ID_SUFFIXES = ['portal', 'root', 'container', 'wrapper', 'mount', 'app'];

/** A noise-class element with more than this much text is a broken wrapper, not noise. */
const SAFETY_VALVE_CHARS = 5000;
/** Forms shorter than this are login/search/newsletter widgets; longer ones wrap a page. */
const FORM_WRAPPER_CHARS = 500;

function isAdClass(classAttr: string): boolean {
    return classAttr.split(/\s+/).some((token) => {
        return (
            token === 'ad' ||
            token.startsWith('ad-') ||
            token.startsWith('ad_') ||
            token.endsWith('-ad') ||
            token.endsWith('_ad')
        );
    });
}

function isStructuralId(id: string): boolean {
    return STRUCTURAL_ID_SUFFIXES.some((s) => id.includes(s));
}

export function isNoise(el: Element): boolean {
    const tag = tagName(el);

    if (tag === 'body' || tag === 'html') return false;
    if (NOISE_TAGS.has(tag)) return true;

    // <form> heuristic: small forms are noise, page-wrapping forms are not.
    if (tag === 'form') {
        const textLen = (el.textContent ?? '').length;
        if (textLen < FORM_WRAPPER_CHARS) return true;
        const cl = (el.getAttribute('class') ?? '').toLowerCase();
        if (
            cl.includes('login') ||
            cl.includes('search') ||
            cl.includes('subscribe') ||
            cl.includes('signup') ||
            cl.includes('newsletter') ||
            cl.includes('contact')
        ) {
            return true;
        }
        return false;
    }

    const role = el.getAttribute('role');
    if (role && NOISE_ROLES.has(role)) return true;

    const classAttr = el.getAttribute('class');
    if (classAttr) {
        let matched = false;
        for (const token of classAttr.split(/\s+/)) {
            const lower = token.toLowerCase();
            if (NOISE_CLASSES.has(lower)) {
                matched = true;
                break;
            }
            if (
                lower.startsWith('footer') ||
                lower.startsWith('header-') ||
                lower.startsWith('nav-')
            ) {
                matched = true;
                break;
            }
        }
        if (!matched) matched = isAdClass(classAttr);

        if (matched) {
            // Safety valve: a noise-class element absorbing the whole page (unclosed
            // tag in malformed HTML) is treated as content.
            if ((el.textContent ?? '').length > SAFETY_VALVE_CHARS) return false;
            return true;
        }
    }

    const id = el.getAttribute('id');
    if (id) {
        const idLower = id.toLowerCase();
        if (NOISE_IDS.has(idLower) && !isStructuralId(idLower)) {
            if ((el.textContent ?? '').length > SAFETY_VALVE_CHARS) return false;
            return true;
        }
        if (COOKIE_CONSENT_PREFIXES.some((p) => idLower.startsWith(p))) return true;
    }

    if (classAttr) {
        const classLower = classAttr.toLowerCase();
        if (COOKIE_CONSENT_PREFIXES.some((p) => classLower.includes(p))) return true;
    }

    return false;
}

export function isNoiseDescendant(el: Element): boolean {
    let node = el.parentElement;
    while (node) {
        if (isNoise(node)) return true;
        node = node.parentElement;
    }
    return false;
}
