import { load } from "../../src/runtime/loader.js";
import { addModule, AttributeSpec, EntityEntry, fetchModule, RecordEntry, RuntimeModule } from "../../src/runtime/module.js";
import { buildGraph, findEdgeForRelationship, RelationshipGraph, RelationshipGraphEdge, RelationshipGraphNode } from "../../src/runtime/relgraph.js";
import { arrayEquals } from "../../src/runtime/util.js";
import { assert, describe, test } from "vitest";

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

describe('Basic loader test', () => {
    test('Check loader with graph', async () => {
        load("example/blog/blog.al", () => {
            const m: RuntimeModule = fetchModule('Blog')
            assert(m.name == 'Blog', 'Failed to load Blog module')
            let re: RecordEntry = m.getEntry('UserPost') as RecordEntry
            assert(re != undefined, "UserPost entry not found")
            const attrs: Set<string> = new Set(["User", "Post"])
            re.schema.keys().forEach((k: string) => {
                assert(attrs.has(k), `Attribute ${k} not found in UserProfile`)
            })
            assert(re.getUserAttributes().size == 0, "UserProfile has no user-attributes")
            re = m.getEntry('Post') as RecordEntry
            assert(re.getUserAttributes().size == 2, 'Post has only 2 attributes')
            const g: RelationshipGraph = buildGraph('Blog')
            const obj: any = g.asObject()
            assert(obj['Blog/User'].length == 2, 'Blog/User must have two edges')
            const roots: RelationshipGraphNode[] = g.getRoots()
            assert(roots.length == 3, "Invalid roots count")
            const node: RelationshipGraphNode = roots[0]
            assert(node.entity.getEntryName() == 'User', "User not found at root")
            assert(node.edges.length == 2, "User must have two relationships")
            const relNames: Set<string> = new Set(["UserProfile", "UserPost"])
            node.edges.forEach((v: RelationshipGraphEdge) => {
                assert(relNames.has(v.relationship.name), `${v.relationship.name} relationship not found`)
            })
            let edge: RelationshipGraphEdge | undefined = findEdgeForRelationship('UserProfile', 'Blog', node.edges)
            assert(edge != undefined, "Edge for UserProfile not found")
            if (edge != undefined) {
                assert(edge.node.entity.getEntryName() == 'Profile', "Profile not found in relationship")
                assert(edge.node.edges.length == 0, "Profile does not have relationships")
            }
            edge = findEdgeForRelationship('UserPost', 'Blog', node.edges)
            assert(edge != undefined, "Edge for UserPost not found")
            if (edge != undefined) {
                assert(edge.node.entity.getEntryName() == 'Post', "Post not found in relationship")
                assert(edge.node.edges.length == 1, "POst has exactly one relationships")
                assert(edge.node.edges[0].node.entity.getEntryName() == 'Category', 'Post must be related to Category')
            }
        })
    })
})