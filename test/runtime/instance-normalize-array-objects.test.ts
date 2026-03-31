import { assert, describe, test } from 'vitest';
import { Instance } from '../../src/runtime/module.js';
import { doInternModule } from '../util.js';

describe('Instance.normalizeAttributes — array of objects from DB', () => {
  test('parses JSON string elements into objects for record[] attributes', async () => {
    await doInternModule(
      'NormArrObj',
      `record RS { x String }
entity E { id Int @id, items RS[] }`
    );

    const inst = Instance.fromObject('E', 'NormArrObj', {
      id: 1,
      items: [
        '{"x":"a"}',
        '{"x":"b"}',
      ],
    });

    assert.deepEqual(inst.lookup('items'), [{ x: 'a' }, { x: 'b' }]);
  });
});
