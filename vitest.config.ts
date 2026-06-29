import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: false,
        environment: 'node',
        include: ['./tests/**/*.{test,spec}.ts', './src/**/*.{test,spec}.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: ['./src/**/*.ts'],
            exclude: ['./src/**/*.{test,spec}.ts', './src/index.ts'],
        },
    },
});
