// Exec-graph tests
import { assert, describe, test } from 'vitest';
import { doInternModule } from '../util.js';
import { executeEvent, executeStatment as executeStatement } from '../../src/runtime/exec-graph.js';
import { Instance, isInstanceOfType, makeInstance, newInstanceAttributes } from '../../src/runtime/module.js';

describe('Basic exec-graph evaluation', () => {
  test('basic-crud', async () => {
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
          workflow deleteE {
            delete {findE {id deleteE.id}}
          }
          `)
    const mke = (id: number, x: number) => {
        return makeInstance('eg01', 'createE', newInstanceAttributes().set('id', id).set('x', x))
    }
    const cre = async (id: number, x: number) => {
        const e: Instance = await executeEvent(mke(id,x))
        chkE(e, id)
        assert(e.lookup('x') == x)
    }
    const chkE = (e: Instance, id: number) => {
        assert(isInstanceOfType(e, 'eg01/E'))
        assert(e.lookup('id') == id)
    }
    await cre(1, 100)
    await cre(2, 200)
    const r02: Instance[] = await executeStatement(`{eg01/E {id? 1}}`)
    assert(r02.length == 1)
    chkE(r02[0], 1)
    const attrs2 = newInstanceAttributes().set('id', 2)
    const finde = makeInstance('eg01', 'findE', attrs2)
    const r03: Instance = await executeEvent(finde)
    chkE(r03, 2)
    const dele = makeInstance('eg01', 'deleteE', attrs2)
    const r04: Instance = await executeEvent(dele)
    chkE(r04, 2)
    const r05 = await executeEvent(finde)
    assert(r05 == null)
    attrs2.set('id', 1)
    const r06: Instance = await executeEvent(finde)
    chkE(r06, 1)
  })
})