import '@testing-library/jest-dom/vitest';
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => undefined }, configurable: true });
