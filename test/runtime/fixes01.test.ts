import { assert, describe, test } from "vitest"
import { doInternModule } from "../util.js"
import { fetchModule, isModule } from "../../src/runtime/module.js"

describe('Issue 92', () => {
    test('Check Issue 92 fix', async () => {
        await doInternModule(`module I92
      entity E {
        id Int @id,
        x Int
    }`)
        const chk = (ent: string) => {
            assert(isModule('I92'))
            const m = fetchModule('I92')
            const ents = m.getEntityNames()
            assert(ents.length == 1 && ents[0] == ent)
        }
        chk('E')
        await doInternModule(`module I92
      entity F {
        id Int @id,
        x Int
    }`)
        chk('F')
    })
})