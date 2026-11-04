import { describe, expect, it } from 'vitest';
import { APP_VERSION, BUILD_ID, PROTOCOL_VERSION } from '../src/version';

describe('version', () => {
  it('comes from the build', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(BUILD_ID).toMatch(/^(dev|[0-9a-f]{7})$/);
    expect(PROTOCOL_VERSION).toBe(3);
  });
});
