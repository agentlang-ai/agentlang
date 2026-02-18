import { describe, test, assert } from 'vitest';
import { ResolverAuthInfo, DefaultAuthInfo } from '../../../src/runtime/resolvers/authinfo.js';

describe('ResolverAuthInfo', () => {
  test('construction with userId only - flags default to false', () => {
    const info = new ResolverAuthInfo('user-123');
    assert.equal(info.userId, 'user-123');
    assert.equal(info.readForUpdate, false);
    assert.equal(info.readForDelete, false);
  });

  test('construction with all flags', () => {
    const info = new ResolverAuthInfo('user-456', true, true);
    assert.equal(info.userId, 'user-456');
    assert.equal(info.readForUpdate, true);
    assert.equal(info.readForDelete, true);
  });

  test('construction with mixed flags', () => {
    const info1 = new ResolverAuthInfo('user-789', true, false);
    assert.equal(info1.readForUpdate, true);
    assert.equal(info1.readForDelete, false);

    const info2 = new ResolverAuthInfo('user-789', false, true);
    assert.equal(info2.readForUpdate, false);
    assert.equal(info2.readForDelete, true);
  });

  test('undefined flags do not override defaults', () => {
    const info = new ResolverAuthInfo('user-abc', undefined, undefined);
    assert.equal(info.readForUpdate, false);
    assert.equal(info.readForDelete, false);
  });

  test('DefaultAuthInfo has expected test userId', () => {
    assert.equal(DefaultAuthInfo.userId, '9459a305-5ee6-415d-986d-caaf6d6e2828');
    assert.equal(DefaultAuthInfo.readForUpdate, false);
    assert.equal(DefaultAuthInfo.readForDelete, false);
  });
});
