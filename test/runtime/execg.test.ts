// Exec-graph tests
import { assert, describe, test } from 'vitest';
import { doInternModule } from '../util.js';
import { executeEvent, executeStatment as executeStatement } from '../../src/runtime/exec-graph.js';
import { Instance, isInstanceOfType, makeInstance, newInstanceAttributes } from '../../src/runtime/module.js';

describe('Basic exec-graph evaluation', () => {
  test('test01', async () => {
    await doInternModule(
          'eg01',
          `entity E {
            id Int @id,
            x Int 
          }
          workflow createE {
            {E {id createE.id, x createE.x}}
          }
          workflow findE {
            {E {id? findE.id}} @as [e]
            e
          }
          `)
    const mke = (id: number, x: number) => {
        return makeInstance('eg01', 'createE', newInstanceAttributes().set('id', id).set('x', x))
    }
    const cre = async (id: number, x: number) => {
        const r01: Instance = await executeEvent(mke(id,x))
        assert(isInstanceOfType(r01, 'eg01/E'))
        assert(r01.lookup('id') == id && r01.lookup('x') == x)
    }
    await cre(1, 100)
    await cre(2, 200)
    const r02: Instance[] = await executeStatement(`{eg01/E {id? 1}}`)
    assert(r02.length == 1)
    assert(isInstanceOfType(r02[0], 'eg01/E'))
    assert(r02[0].lookup('id') == 1)
    const finde = makeInstance('eg01', 'findE', newInstanceAttributes().set('id', 2))
    const r03: Instance = await executeEvent(finde)
    assert(isInstanceOfType(r03, 'eg01/E'))
    assert(r03.lookup('id') == 2)
  })
})