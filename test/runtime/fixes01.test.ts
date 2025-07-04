import { assert, describe, test } from "vitest"
import { doInternModule } from "../util.js"
import { fetchModule, Instance, isInstanceOfType, isModule } from "../../src/runtime/module.js"
import { parseAndEvaluateStatement } from "../../src/runtime/interpreter.js"

describe('Issue 92', () => {
    test('Check fix for issue-92', async () => {
        await doInternModule('I92', `entity E { id Int @id, x Int }`)
        const chk = (ent: string) => {
            assert(isModule('I92'))
            const m = fetchModule('I92')
            const ents = m.getEntityNames()
            assert(ents.length == 1 && ents[0] == ent)
        }
        chk('E')
        await doInternModule('I92', `entity F { id Int @id, x Int }`)
        chk('F')
    })
})

describe('Issue 97', () => {
    test('Check fix for issue-97', async () => {
        await doInternModule('I97',
            `entity Resource { id UUID @id @default(uuid()), name String }
             entity Allocation { id UUID @id @default(uuid()), name String @optional }
             relationship ResAlloc between(Resource, Allocation) @one_many

            workflow FetchResourceAllocations {
                {I97/Resource { id? FetchResourceAllocations.id },
                 I97/ResAlloc {I97/Allocation? {}},
                into {e I97/Resource.name, t I97/Allocation.name}}
            }

            workflow FetchAllResourceAllocations {
                {I97/Resource? {},
                 I97/ResAlloc {I97/Allocation? {}},
                 into {e I97/Resource.name, t I97/Allocation.name}}
            }

            workflow FetchAllocationsResource{
               {I97/Allocation {id? FetchAllocationsResource.id},
                I97/ResAlloc {I97/Resource? {}},
                into {e I97/Resource.name, t I97/Allocation.name}}
            }

            workflow CreateAllocation {
               {I97/Allocation {name CreateAllocation.name},
                I97/ResAlloc {I97/Resource {id? CreateAllocation.id}}}
            }
             `
        )
        const isr = (r: any) => assert(isInstanceOfType(r, 'I97/Resource'))
        const isa = (r: any) => assert(isInstanceOfType(r, 'I97/Allocation'))
        const crr = async (name: string): Promise<Instance> => {
            const r: any = await parseAndEvaluateStatement(`{I97/Resource {name "${name}"}}`)
            isr(r)
            return r as Instance
        }
        const cra = async (resource: Instance, name: string): Promise<Instance> => {
            const r: any = await parseAndEvaluateStatement(`{I97/Resource {id? "${resource.lookup('id')}"},
                I97/ResAlloc {I97/Allocation {name "${name}"}}}`)
            isr(r[0])
            const a: Instance[] | undefined = (r[0] as Instance).getRelatedInstances('I97/ResAlloc')
            assert(a && a.length == 1)
            isa(a[0])
            return a[0] as Instance
        }
        const r01 = await crr('r01')
        const a01 = await cra(r01, 'a01')
        await cra(r01, 'a02')
        const r02 = await crr('r02')
        const a03 = await cra(r02, 'a03')
        let result: any[] = await parseAndEvaluateStatement(`{I97/FetchResourceAllocations {id "${r01.lookup("id")}"}}`)
        assert(result.length == 2)
        const chk2 = (result: any[]) => assert(result.every((obj: any) => { return obj.e == 'r01' && (obj.t == 'a01' || obj.t == 'a02')}))
        chk2(result)
        result = await parseAndEvaluateStatement(`{I97/FetchAllResourceAllocations {}}`)
        assert(result.length == 3)
        chk2(result.filter((r: any) => { return r.e == 'r01' }))
        const r = result.filter((r: any) => { return r.e == 'r02'})
        assert(r.length == 1)
        assert(r[0].t == 'a03')
        await parseAndEvaluateStatement(`{I97/FetchAllocationsResource {id "${a01.lookup('id')}"}}`)
        .then((result: any[]) => {
            assert(result.length == 1)
            assert(result[0].e == 'r01' && result[0].t == 'a01')
        })
        await parseAndEvaluateStatement(`{I97/FetchAllocationsResource {id "${a03.lookup('id')}"}}`)
        .then((result: any[]) => {
            assert(result.length == 1)
            assert(result[0].e == 'r02' && result[0].t == 'a03')
        })
        isa(await parseAndEvaluateStatement(`{I97/CreateAllocation {id "${r02.lookup('id')}", name "a04"}}`))
        await parseAndEvaluateStatement(`{I97/FetchResourceAllocations {id "${r02.lookup("id")}"}}`)
        .then((result: any[]) => {
            assert(result.length == 2)
            assert(result.every((r: any) => { return r.e == 'r02' && (r.t == 'a03' || r.t == 'a04')}))
        })
    })
})

describe('Issue 97 (contains)', () => {
    test('Check fix for issue-97 (contains)', async () => {
        await doInternModule('I97C',
            `entity Resource { id UUID @id @default(uuid()), name String }
             entity Allocation { id UUID @id @default(uuid()), name String @optional }
             relationship ResAlloc contains(I97C/Resource, I97C/Allocation)

            workflow FetchResourceAllocations {
                {I97C/Resource { id? FetchResourceAllocations.id },
                 I97C/ResAlloc {I97C/Allocation? {}},
                into {e I97C/Resource.name, t I97C/Allocation.name}}
            }

            workflow FetchAllResourceAllocations {
                {I97C/Resource? {},
                 I97C/ResAlloc {I97C/Allocation? {}},
                 into {e I97C/Resource.name, t I97C/Allocation.name}}
            }

            workflow FetchAllocationsResource{
               {I97C/Allocation {id? FetchAllocationsResource.id},
                I97C/ResAlloc {I97C/Resource? {}},
                into {e I97C/Resource.name, t I97C/Allocation.name}}
            }
             `
        )
        const isr = (r: any) => assert(isInstanceOfType(r, 'I97C/Resource'))
        const isa = (r: any) => assert(isInstanceOfType(r, 'I97C/Allocation'))
        const crr = async (name: string): Promise<Instance> => {
            const r: any = await parseAndEvaluateStatement(`{I97C/Resource {name "${name}"}}`)
            isr(r)
            return r as Instance
        }
        const cra = async (resource: Instance, name: string): Promise<Instance> => {
            const r: any = await parseAndEvaluateStatement(`{I97C/Resource {id? "${resource.lookup('id')}"},
                I97C/ResAlloc {I97C/Allocation {name "${name}"}}}`)
            isr(r[0])
            const a: Instance[] | undefined = (r[0] as Instance).getRelatedInstances('I97C/ResAlloc')
            assert(a && a.length == 1)
            isa(a[0])
            return a[0] as Instance
        }
        const r01 = await crr('r01')
        const a01 = await cra(r01, 'a01')
        await cra(r01, 'a02')
        const r02 = await crr('r02')
        const a03 = await cra(r02, 'a03')
        let result: any[] = await parseAndEvaluateStatement(`{I97C/FetchResourceAllocations {id "${r01.lookup("id")}"}}`)
        assert(result.length == 2)
        const chk2 = (result: any[]) => assert(result.every((obj: any) => { return obj.e == 'r01' && (obj.t == 'a01' || obj.t == 'a02')}))
        chk2(result)
        result = await parseAndEvaluateStatement(`{I97C/FetchAllResourceAllocations {}}`)
        assert(result.length == 3)
        chk2(result.filter((r: any) => { return r.e == 'r01' }))
        const r = result.filter((r: any) => { return r.e == 'r02'})
        assert(r.length == 1)
        assert(r[0].t == 'a03')
        await parseAndEvaluateStatement(`{I97C/FetchAllocationsResource {id "${a01.lookup('id')}"}}`)
        .then((result: any[]) => {
            assert(result.length == 1)
            assert(result[0].e == 'r01' && result[0].t == 'a01')
        })
        await parseAndEvaluateStatement(`{I97C/FetchAllocationsResource {id "${a03.lookup('id')}"}}`)
        .then((result: any[]) => {
            assert(result.length == 1)
            assert(result[0].e == 'r02' && result[0].t == 'a03')
        })
    })
})