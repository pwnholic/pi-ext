/**
 * Ports: the slice of the Pi host we depend on, expressed as our own
 * interfaces. The real `@earendil-works/pi-coding-agent` API is adapted to
 * these in `adapter.ts`, so nothing under core/ or modules/ imports the SDK
 * directly. This keeps the architecture testable and swappable.
 */

export interface ToolTextResult {
    readonly content: ReadonlyArray<{
        readonly type: 'text';
        readonly text: string;
    }>;
    readonly details?: Record<string, unknown>;
}

export interface ToolDefinition<Params> {
    readonly name: string;
    readonly label: string;
    readonly description: string;
    /** JSON-schema-like parameter spec; the adapter maps this to typebox. */
    readonly parameters: unknown;
    execute(params: Params, signal: AbortSignal): Promise<ToolTextResult>;
}

export interface WidgetHandle {
    set(content: string): void;
    remove(): void;
}

export interface ExtensionHost {
    registerTool<P>(tool: ToolDefinition<P>): void;
    onSessionShutdown(handler: () => void | Promise<void>): void;
    notify(message: string, level?: 'info' | 'warn' | 'error'): void;
    widget(id: string): WidgetHandle;
}
