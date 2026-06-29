import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: false,
        environment: 'node',
        include: ['./pi-pwnholic/tests/**/*.{test,spec}.ts', './pi-pwnholic/src/**/*.{test,spec}.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: ['./pi-pwnholic/src/**/*.ts'],
            exclude: ['./pi-pwnholic/src/**/*.{test,spec}.ts', './pi-pwnholic/src/index.ts'],
        },
    },
});
