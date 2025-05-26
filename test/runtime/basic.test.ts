import { describe, test } from "vitest";
import { addModule, AttributeSpec, EntityEntry, fetchModule, RecordEntry, RuntimeModule } from "../../src/runtime/module.js";
import { assert } from "console";
import { arrayEquals } from "../../src/runtime/util.js";

function createTestModule(): RuntimeModule | undefined {
    addModule('Acme')
    try {
        return fetchModule('Acme')
    } catch (err) {
        console.log("ERROR - " + err)
        return undefined
    }
}

function addTestRecords(mod: RuntimeModule) {
    const entry1: RecordEntry = new RecordEntry("A", "Acme")
    entry1.addAttribute("x", { type: "Int" })
    mod.addEntry(entry1)
    const entry2: EntityEntry = new EntityEntry("B", "Acme")
    const p1: Map<string, any> = new Map()
    p1.set("@id", true)
    const aspec1: AttributeSpec = { type: "String", properties: p1 }
    entry2.addAttribute("id", aspec1)
    entry2.addAttribute("name", { type: "String" })
    mod.addEntry(entry2)
    const entry3: EntityEntry = new EntityEntry("C", "Acme")
    const p2: Map<string, any> = new Map()
    p1.set("@id", true)
    const aspec2: AttributeSpec = { type: "String", properties: p2 }
    entry3.addAttribute("id", aspec2)
    entry3.addAttribute("age", { type: "Int" })
    mod.addEntry(entry3)
}

describe('Basic module operations', () => {
    test('check create module', async () => {
        const m: RuntimeModule | undefined = createTestModule()
        assert(m != undefined, "Failed to create test module")
        if (m != undefined) {
            assert(m.name == 'Acme', "Not the expected module`")
            addTestRecords(m)
            assert(arrayEquals(m.getRecordNames(), ["A"]), "Mismatch in record names")
            assert(arrayEquals(m.getEntityNames(), ["B", "C"]), "Mismatch in entity names")
            m.removeEntry("B")
            assert(arrayEquals(m.getRecordNames(), ["A"]), "Mismatch in record names")
            assert(arrayEquals(m.getEntityNames(), ["C"]), "Failed to remove entity B")
            m.removeEntry("A")
            assert(arrayEquals(m.getRecordNames(), []), "Failed to remove record A")
            m.removeEntry("C")
            assert(arrayEquals(m.getEntityNames(), []), "Failed to remove entity C")
        }
    });
});