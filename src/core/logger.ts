export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
    debug(message: string, fields?: Record<string, unknown>): void;
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
    child(bindings: Record<string, unknown>): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

export function createLogger(
    minLevel: LogLevel = 'info',
    bindings: Record<string, unknown> = {},
): Logger {
    const threshold = LEVEL_ORDER[minLevel];

    const log = (level: LogLevel, message: string, fields?: Record<string, unknown>): void => {
        if (LEVEL_ORDER[level] < threshold) return;
        const line = {
            level,
            message,
            ...bindings,
            ...fields,
            ts: new Date().toISOString(),
        };
        const sink = level === 'error' || level === 'warn' ? console.error : console.error;
        sink(JSON.stringify(line));
    };

    return {
        debug: (m, f) => log('debug', m, f),
        info: (m, f) => log('info', m, f),
        warn: (m, f) => log('warn', m, f),
        error: (m, f) => log('error', m, f),
        child: (extra) => createLogger(minLevel, { ...bindings, ...extra }),
    };
}
