// Exec-graph tests
import { assert, describe, test } from 'vitest';
import { doInternModule } from '../util.js';
import { executeEventHelper, executeStatement as executeStatement } from '../../src/runtime/exec-graph.js';
import { Instance, isInstanceOfType, makeInstance, newInstanceAttributes } from '../../src/runtime/module.js';

describe('Basic exec-graph evaluation', () => {
  test('basic-patterns', async () => {
    await doInternModule(
      'exg01',
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
          record R {
            y Int
          }
          workflow createRs {
            for e in {E? {}} {
              if (e.x == 100) {
                {R {y e.x * 10}}
              } else {
                {R {y e.x * 4}}
              }
            } @as rs;
            rs
          }
          `)
    const mke = (id: number, x: number) => {
      return makeInstance('exg01', 'createE', newInstanceAttributes().set('id', id).set('x', x))
    }
    const cre = async (id: number, x: number) => {
      const e: Instance = await executeEventHelper(mke(id, x))
      chkE(e, id)
      assert(e.lookup('x') == x)
    }
    const chkE = (e: Instance, id: number) => {
      assert(isInstanceOfType(e, 'exg01/E'))
      assert(e.lookup('id') == id)
    }
    await cre(1, 100)
    await cre(2, 200)
    const r02: Instance[] = await executeStatement(`{exg01/E {id? 1}}`)
    assert(r02.length == 1)
    chkE(r02[0], 1)
    const attrs2 = newInstanceAttributes().set('id', 2)
    const finde = makeInstance('exg01', 'findE', attrs2)
    const r03: Instance = await executeEventHelper(finde)
    chkE(r03, 2)
    const rs: Instance[] = await executeStatement(`{exg01/createRs {}}`)
    assert(rs.every((inst: Instance) => {
      assert(isInstanceOfType(inst, 'exg01/R'))
      const y = inst.lookup('y')
      return y == 1000 || y == 800
    }))
    const dele = makeInstance('exg01', 'deleteE', attrs2)
    const r04: Instance = await executeEventHelper(dele)
    chkE(r04, 2)
    const r05 = await executeEventHelper(finde)
    assert(r05 == null)
    attrs2.set('id', 1)
    const r06: Instance = await executeEventHelper(finde)
    chkE(r06, 1)
  })

  test('basic-agents', async () => {
    if (process.env.AL_TEST === 'true') {
      await doInternModule(
        'exg02',
        `entity Person {
            email Email @id
            name String
          }
          agent personManager {
            instruction "Based on user request, create, update and delete persons",
            tools [exg02/Person]
          }
          `)
      const r01: Instance = await executeStatement(`{exg02/personManager {message "create Joe with email joe@acme.com"}}`)
      assert(isInstanceOfType(r01, 'exg02/Person'))
      assert(r01.lookup('email') == 'joe@acme.com' && r01.lookup('name') == 'Joe')
    }
  })
})