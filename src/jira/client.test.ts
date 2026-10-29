import { describe, expect, it, vi } from 'vitest';

// The Forge runtime modules are not available in unit tests; only the query text is under test here.
vi.mock('@forge/api', () => ({ default: {}, route: () => '' }));
vi.mock('@forge/llm', () => ({ chat: () => null }));

describe('Teamwork Graph query', () => {
  it('uses an operation name of the shape company_operation, which the graph gateway requires', async () => {
    const { RELATED_WORK_QUERY } = await import('./client');
    const name = RELATED_WORK_QUERY.match(/^query (\w+)\(/)?.[1] ?? '';
    expect(name).toMatch(/^[A-Za-z0-9]{3,}_[A-Za-z0-9]{4,}$/);
    expect(name.length).toBeLessThanOrEqual(100);
  });
});
