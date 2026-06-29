import { parseHTML } from 'linkedom';

/** DOM node type constants (linkedom mirrors the standard numeric values). */
export const NODE_ELEMENT = 1;
export const NODE_TEXT = 3;

export function parseDocument(html: string): Document {
    const { document } = parseHTML(html);
    return document;
}

/** Lowercased tag name. linkedom/DOM report tagName in uppercase. */
export function tagName(el: Element): string {
    return el.tagName.toLowerCase();
}

export function isElement(node: Node): node is Element {
    return node.nodeType === NODE_ELEMENT;
}

export function isText(node: Node): node is Text {
    return node.nodeType === NODE_TEXT;
}
