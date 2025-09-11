// Exec-graph tests
import { assert, describe, test } from 'vitest';
import { doInternModule } from '../util.js';
import { executeGraph, generateExecutionGraph } from '../../src/runtime/exec-graph.js';
import { Environment } from '../../src/runtime/interpreter.js';
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
          `)
    const g01 = await generateExecutionGraph('eg01/createE')
    assert(g01 != undefined)
    const env = new Environment()
    env.bind('createE', makeInstance('eg01', 'createE', newInstanceAttributes().set('id', 1).set('x', 100)))
    await executeGraph(g01, env)
    await env.commitAllTransactions();
    const r01: Instance = env.getLastResult()
    assert(isInstanceOfType(r01, 'eg01/E'))
    assert(r01.lookup('id') == 1 && r01.lookup('x') == 100)
  })
})