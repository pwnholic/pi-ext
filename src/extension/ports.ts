import type { TObject } from 'typebox';

/**
 * Ports: the slice of the Pi host we depend on. The real
 * `@earendil-works/pi-coding-agent` ExtensionAPI is adapted to these in
 * `adapter.ts`, so nothing under core/ or modules/ imports the SDK directly.
 */

/** Typebox parameter schema produced by tool definitions. */
export type ToolParameters = TObject;

export interface ToolTextResult {
    readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
    readonly details?: Record<string, unknown>;
}

export interface ToolDefinition<Params> {
    readonly name: string;
    readonly label: string;
    readonly description: string;
    readonly promptSnippet?: string;
    readonly parameters: ToolParameters;
    execute(params: Params, signal: AbortSignal): Promise<ToolTextResult>;
}

export interface ExtensionHost {
    registerTool<P>(tool: ToolDefinition<P>): void;
    onSessionShutdown(handler: () => void | Promise<void>): void;
    notify(message: string, level?: 'info' | 'warn' | 'error'): void;
}
