import { assert, describe, test } from "vitest"
import { doInternModule } from "../util.js"
import { fetchModule, Instance, isInstanceOfType, isModule } from "../../src/runtime/module.js"
import { parseAndEvaluateStatement } from "../../src/runtime/interpreter.js"
import { isUsingSqlite } from "../../src/runtime/resolvers/sqldb/database.js"

describe('Issue 92', () => {
    test('Refresh modules on reload', async () => {
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
    test('test01', async () => {
        await doInternModule('I97',
            `entity Resource { id UUID @id @default(uuid()), name String }
             entity Allocation { id UUID @id @default(uuid()), name String @optional, entered Number @default(0)}
             relationship ResAlloc between(Resource, Allocation) @one_many

            workflow FetchResourceAllocations {
                {I97/Resource { id? FetchResourceAllocations.id },
                 I97/ResAlloc {I97/Allocation? {}},
                @into {e I97/Resource.name, t I97/Allocation.name, r I97/Allocation.entered}}
            }

            workflow FetchAllResourceAllocations {
                {I97/Resource? {},
                 I97/ResAlloc {I97/Allocation? {}},
                 @into {e I97/Resource.name, t I97/Allocation.name, r I97/Allocation.entered}}
            }

            workflow FetchAllocationsResource{
               {I97/Allocation {id? FetchAllocationsResource.id},
                I97/ResAlloc {I97/Resource? {}},
                @into {e I97/Resource.name, t I97/Allocation.name, r I97/Allocation.entered}}
            }

            workflow CreateAllocation {
               {I97/Allocation {name CreateAllocation.name, entered 0.234},
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
        const chk2 = (result: any[]) => assert(result.every((obj: any) => { return obj.e == 'r01' && (obj.t == 'a01' || obj.t == 'a02') }))
        chk2(result)
        result = await parseAndEvaluateStatement(`{I97/FetchAllResourceAllocations {}}`)
        assert(result.length == 3)
        chk2(result.filter((r: any) => { return r.e == 'r01' }))
        const r = result.filter((r: any) => { return r.e == 'r02' })
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
                assert(result.every((r: any) => { return r.e == 'r02' && ((r.t == 'a03' || r.t == 'a04') && (r.r === 0 || r.r === 0.234)) }))
            })
    })
})

describe('Issue 97 (contains)', () => {
    test('test01', async () => {
        await doInternModule('I97C',
            `entity Resource { id UUID @id @default(uuid()), name String }
             entity Allocation { id UUID @id @default(uuid()), name String @optional }
             relationship ResAlloc contains(I97C/Resource, I97C/Allocation)

            workflow FetchResourceAllocations {
                {I97C/Resource { id? FetchResourceAllocations.id },
                 I97C/ResAlloc {I97C/Allocation? {}},
                @into {e I97C/Resource.name, t I97C/Allocation.name}}
            }

            workflow FetchAllResourceAllocations {
                {I97C/Resource? {},
                 I97C/ResAlloc {I97C/Allocation? {}},
                 @into {e I97C/Resource.name, t I97C/Allocation.name}}
            }

            workflow FetchAllocationsResource{
               {I97C/Allocation {id? FetchAllocationsResource.id},
                I97C/ResAlloc {I97C/Resource? {}},
                @into {e I97C/Resource.name, t I97C/Allocation.name}}
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
        const chk2 = (result: any[]) => assert(result.every((obj: any) => { return obj.e == 'r01' && (obj.t == 'a01' || obj.t == 'a02') }))
        chk2(result)
        result = await parseAndEvaluateStatement(`{I97C/FetchAllResourceAllocations {}}`)
        assert(result.length == 3)
        chk2(result.filter((r: any) => { return r.e == 'r01' }))
        const r = result.filter((r: any) => { return r.e == 'r02' })
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

describe('Issue 117 (number-datatype)', () => {
    test('test01', async () => {
        await doInternModule('I117',
            `entity E {
               id Int @id
               x Number
            }`)
        const ise = (x: any) => isInstanceOfType(x, 'I117/E')
        const cre = async (id: number, x: number): Promise<Instance> => {
            const obj: any = await parseAndEvaluateStatement(`{I117/E {id ${id}, x ${x}}}`)
            assert(ise(obj))
            return obj as Instance
        }
        const fe = async (id: number, x: number) => {
            const insts: Instance[] = await parseAndEvaluateStatement(`{I117/E {id? ${id}}}`)
            assert(insts.length == 1)
            assert(ise(insts[0]))
            assert(insts[0].lookup('x') == x)
        }
        await cre(1, 10099393.434)
        await cre(2, 43343333)
        await fe(1, 10099393.434)
        await fe(2, 43343333)
    })
})

describe('Issue 179 - @from', () => {
    test('test01', async () => {
        await doInternModule('I179',
            `entity E {
               id Int @id,
               x Number,
               y String @default("abc")
            }
            workflow CreateE {
                {E {}, @from CreateE.data}
            }`)
        const cre = async function (data: string): Promise<Instance> {
            const inst = await parseAndEvaluateStatement(`{I179/CreateE {data ${data}}}`)
            assert(isInstanceOfType(inst, "I179/E"))
            return inst
        }
        let inst = await cre(`{"id": 1, "x": 100, "y": "xyz"}`)
        assert(inst.lookup("id") == 1)
        assert(inst.lookup("x") == 100)
        assert(inst.lookup("y") == "xyz")
        inst = await cre(`{"id": 2, "x": 200}`)
        assert(inst.lookup("id") == 2)
        assert(inst.lookup("x") == 200)
        assert(inst.lookup("y") == "abc")
    })
})

if (isUsingSqlite()) { // Postgres will rollback transaction on SQL error
    describe('Issue-197', () => {
        test('Catch handler should execute', async () => {
            await doInternModule(
                'I197',
                `entity E {
        id Int @id,
        x Int,
        @after {create I197/AfterCreateE}
      }
      entity F {
        id Int @id,
        y Int
      }
      workflow AfterCreateE {
        {F {id 1, y 10}}
      }
      workflow HandleError {
        {F {id 2, y 20}}
      }
      `);
            const cre = (async (id: number, x: number): Promise<any> => {
                await parseAndEvaluateStatement(`{I197/E {id ${id}, x ${x}}}
            @catch {error {I197/HandleError {}}}`)
            })
            await cre(1, 10)
            await cre(2, 20)
            const chk = (async (n: string) => {
                await parseAndEvaluateStatement(`{I197/${n}? {}}`).then((result: Instance[]) => {
                    assert(result.length == 2)
                    const ids = result.map((inst: Instance) => { return inst.lookup('id') })
                    assert(ids.find((v: number) => { return v == 1 }))
                    assert(ids.find((v: number) => { return v == 2 }))
                })
            });
            await chk('E')
            await chk('F')
        });
    });
}

describe('Issue-209', () => {
    test('test01', async () => {
        await doInternModule('I209',
            `entity Resource {
    Id UUID @id @default(uuid()),
    Email Email @unique
}

entity Allocation {
    Id UUID @id @default(uuid()),
    Period Date
}

relationship ResourceAllocation contains(Resource, Allocation)

workflow ResourcesForAllocations {
    {Allocation {Period?between [ResourcesForAllocations.StartDate, ResourcesForAllocations.EndDate]},
     ResourceAllocation {Resource? {}},
     @into {remail Resource.Email, rid Resource.Id}}
}
workflow DistinctResourcesForAllocations {
    {Allocation {Period?between [DistinctResourcesForAllocations.StartDate, DistinctResourcesForAllocations.EndDate]},
     ResourceAllocation {Resource? {}},
     @into {remail Resource.Email, rid Resource.Id},
     @distinct}
}
`
        )

        const crr = async (email: string): Promise<Instance> => {
            const r = await parseAndEvaluateStatement(`{I209/Resource {Email "${email}"}}`)
            assert(isInstanceOfType(r, 'I209/Resource'))
            return r
        }

        const cra = async (resId: string, period: string): Promise<Instance | undefined> => {
            const res = await parseAndEvaluateStatement(`{I209/Resource {
                Id? "${resId}"},
                I209/ResourceAllocation {I209/Allocation {Period "${period}"}}
                }`)
            const r: Instance = res[0]
            const rels = r.getRelatedInstances('I209/ResourceAllocation')
            if (rels) {
                const a = rels[0]
                assert(isInstanceOfType(a, 'I209/Allocation'))
                return a
            } else {
                assert(rels != undefined)
                return undefined
            }
        }

        const rfas = async (start: string, end: string, distinct: boolean = false): Promise<Instance[]> => {
            const event = distinct ? 'DistinctResourcesForAllocations' : 'ResourcesForAllocations'
            const res: Instance[] = await parseAndEvaluateStatement(`{I209/${event} {StartDate "${start}", EndDate "${end}"}}`)
            return res
        }

        const r1 = await crr("a@acme.com")
        const id1 = r1.lookup('Id')
        await cra(id1, "2025-01-01")
        await cra(id1, "2025-02-01")
        await cra(id1, "2025-03-12")
        let rs: any[] = await rfas("2025-01-01", "2025-02-10")
        assert(rs.length == 2)
        assert(rs[0].remail == "a@acme.com")
        assert(rs[1].remail == rs[0].remail)
        rs = await rfas("2025-01-01", "2025-02-10", true)
        const r2 = await crr("b@acme.com")
        const id2 = r2.lookup('Id')
        await cra(id2, "2025-01-10")
        await cra(id2, "2024-01-10")
        rs = await rfas("2025-01-01", "2025-02-10")
        assert(rs.length == 3)
        const f = (email: string): any[] => {
            return rs.filter((v: any) => {
                return v.remail == email
            })
        }
        assert(f('a@acme.com').length == 2)
        assert(f('b@acme.com').length == 1)
        rs = await rfas("2025-01-01", "2025-02-10", true)
        assert(rs.length == 2)
        assert(f('a@acme.com').length == 1)
        assert(f('b@acme.com').length == 1)
    })
})

describe('Issue-226', () => {
    test('test01', async () => {
        await doInternModule('I226',
            `entity E {
                id Int @id,
                x Int
            }
            record R {
                y Int
            }
            workflow W {
                {E? {}} @as es;
                for e in es {
                    {R {y e.x * 10}}
                }
            }
            `)
        const cre = async (id: number, x: number) => {
            const r: any = await parseAndEvaluateStatement(`{I226/E {id ${id}, x ${x}}}`)
            assert(isInstanceOfType(r, 'I226/E'))
        }
        const idxs = [[1, 10], [2, 20], [3, 30]]
        let expectedSum = 0
        for (let i = 0; i < idxs.length; ++i) {
            const [id, x] = idxs[i]
            await cre(id, x)
            expectedSum += (x * 10)
        }
        const rs: Instance[] = await parseAndEvaluateStatement(`{I226/W {}}`)
        assert(rs.length == 3)
        assert(rs.every((inst: Instance) => {
            return isInstanceOfType(inst, 'I226/R')
        }))
        let sum = 0
        rs.forEach((inst: Instance) => {
            sum += inst.lookup('y')
        })
        assert(sum == expectedSum)
    })
})

describe('Issue-226', () => {
    test('test01', async () => {
        await doInternModule('I233',
            `entity Resource {
    Id Int @id ,
    Email Email @unique
}

entity Allocation {
    Id Int @id,
    Name String
}

relationship ResourceAllocation contains(Resource, Allocation)

workflow GetResourceAllocation1 {
    {Resource {Id? GetResourceAllocation1.Id},
     ResourceAllocation {Allocation? {}}}
}

workflow GetResourceAllocation2 {
    {Resource {Id? GetResourceAllocation2.Id},
     ResourceAllocation {Allocation? {}},
     @into {Id Allocation.Id,
         AllocationEntered Allocation.Name}}
}

workflow GetAllocationResource {
    {Allocation? {},
     ResourceAllocation {Resource? {}}}
}

workflow GetOneAllocationResource {
    {Allocation {Id? GetOneAllocationResource.Id},
     ResourceAllocation {Resource? {}}}
}
`)

        const crr = async (id: number, email: string) => {
            const r = await parseAndEvaluateStatement(`{I233/Resource {Id ${id}, Email "${email}"}}`)
            assert(isInstanceOfType(r, 'I233/Resource'))
            return r
        }

        const cra = async (resId: number, id: number, name: string) => {
            const rs = await parseAndEvaluateStatement(`{I233/Resource {Id? ${resId}},
        I233/ResourceAllocation {I233/Allocation {Id ${id}, Name "${name}"}}}`)
            assert(rs && rs.length == 1)
            const r: Instance = rs[0]
            assert(isInstanceOfType(r, 'I233/Resource'))
            const rrs: Instance[] | undefined = r.getRelatedInstances('I233/ResourceAllocation')
            if (rrs) {
                assert(rrs.length == 1)
                assert(isInstanceOfType(rrs[0], 'I233/Allocation'))
            } else {
                assert(rrs != undefined)
            }
        }

        const getra = async (resId: number, intoResultCount?: number) => {
            const rs = await parseAndEvaluateStatement(`{I233/GetResourceAllocation${intoResultCount ? '2' : '1'} {Id ${resId}}}`)
            const rrs: any = intoResultCount ? rs.map((x: object) => {
                return new Map(Object.entries(x))
            }) : rs[0].getRelatedInstances('ResourceAllocation')
            let s = 0
            rrs?.forEach((inst: any) => {
                s += inst.get('Id')
            })
            if (intoResultCount) {
                assert(rs.length == intoResultCount)
            } else {
                assert(rs.length == 1)
                if (resId == 1) {
                    assert(rrs?.length == 2)
                    assert(s == (101 + 102))
                } else {
                    assert(rrs?.length == 1)
                    assert(s == 201)
                }
            }
        }

        const chkresId = (inst: Instance, resId: number) => {
            const rs = inst.getRelatedInstances('ResourceAllocation')
            assert(rs?.length == 1)
            if (rs) {
                assert(rs[0].lookup('Id') == resId)
            }
        }

        const getar = async () => {
            const rs: Instance[] = await parseAndEvaluateStatement(`{I233/GetAllocationResource {}}`)
            assert(rs.length == 3)
            const chka = (id: number, resId: number) => {
                const r: Instance | undefined = rs.find((inst: Instance) => {
                    return id == inst.lookup('Id')
                })
                if (r) {
                    chkresId(r, resId)
                } else {
                    assert(r != undefined)
                }
            }
            chka(101, 1)
            chka(102, 1)
            chka(201, 2)
        }

        const getar1 = async (id: number, resId: number) => {
            const rs: Instance[] = await parseAndEvaluateStatement(`{I233/GetOneAllocationResource {Id ${id}}}`)
            assert(rs.length == 1)
            chkresId(rs[0], resId)
        }

        await crr(1, 'a@acme.com')
        await crr(2, 'b@acme.com')
        await cra(1, 101, 'aa')
        await cra(1, 102, 'ab')
        await cra(2, 201, 'bb')
        await getra(1)
        await getra(1, 2)
        await getar()
        await getar1(101, 1)
        await getar1(102, 1)
        await getar1(201, 2)
    })
})

describe('Issue-272', () => {
    test('PUT bug for arrays', async () => {
        await doInternModule('I272',
            `record RangeSettings {
    Id String,
    From String
}

entity AllocationRangeSetting {
    Id UUID @id @default(uuid()),
    AllocationRanges RangeSettings[] @optional
}`
        )
        const cr = async (settings: any[]): Promise<Instance> => {
            const jsonSettings = JSON.stringify(settings)
            const s = `{I272/AllocationRangeSetting {AllocationRanges ${jsonSettings}}}`
            const r = await parseAndEvaluateStatement(s)
            assert(isInstanceOfType(r, 'I272/AllocationRangeSetting'))
            return r
        }
        const ur = async (id: string, settings: any[]): Promise<Instance> => {
            const jsonSettings = JSON.stringify(settings)
            const s = `{I272/AllocationRangeSetting {Id? "${id}", AllocationRanges ${jsonSettings}}}`
            const rs: Instance[] = await parseAndEvaluateStatement(s)
            assert(rs.length == 1)
            assert(isInstanceOfType(rs[0], 'I272/AllocationRangeSetting'))
            return rs[0]
        }
        const lr = async (id: string): Promise<Instance> => {
            const s = `{I272/AllocationRangeSetting {Id? "${id}"}}`
            const rs: Instance[] = await parseAndEvaluateStatement(s)
            assert(rs.length == 1)
            assert(isInstanceOfType(rs[0], 'I272/AllocationRangeSetting'))
            return rs[0]
        }
        const r1: Instance = await cr([{ Id: "123", From: "A" }, { Id: "234", From: "B" }])
        const id = r1.lookup('Id')
        const r2: Instance = await lr(id)
        const sa: any[] = r2.lookup('AllocationRanges')
        assert(sa.length == 2)
        let ids = new Set(["123", "234"])
        assert(sa.every((v: any) => {
            return ids.has(v.Id)
        }))
        const r3: Instance = await ur(id, [{ Id: "456", From: "D" }, { Id: "678", From: "E" }])
        const sb: any[] = r3.lookup('AllocationRanges')
        assert(sb.length == 2)
        ids = new Set(["456", "678"])
        assert(sb.every((v: any) => {
            return ids.has(v.Id)
        }))
        const r4: Instance = await lr(id)
        const sc: any[] = r4.lookup('AllocationRanges')
        assert(sc.length == 2)
        assert(sc.every((v: any) => {
            return ids.has(v.Id)
        }))
    })
})

describe('Issue-297', () => {
    test('Return bug fix', async () => {
        await doInternModule('I297',
            `entity E {
                id Int @id
            }
            workflow A {
                {E {id 1}} @as e;
                return e;
                {E {id 2}}
            }
            workflow B {
                {A {}};
                {E {id 3}}
            }
            `)
        await parseAndEvaluateStatement(`{I297/B {}}`)
        const rs: Instance[] = await parseAndEvaluateStatement(`{I297/E? {}}`)
        assert(rs.length == 2)
        const ids = new Set([1, 3])
        rs.forEach((inst: Instance) => {
            assert(ids.has(inst.lookup('id')))
        })
    })
})

describe('Issue-339', () => {
    test('Block-structure test', async () => {
        await doInternModule('I339',
            `entity E {
                id Int @id,
                x Int
            }
            workflow EF {
                EF.e @as e;
                if (EF.mode == 1) {
                    100 @as e
                    {E {id 1, x e}}
                } else {
                    {E {id 2, x e}}
                } @as r;
                {E {id EF.mode+10, x e}} @as s
                [r, s]
            }
            `)
        const chk = (inst: Instance, id: number, x: number) => {
            assert(isInstanceOfType(inst, 'I339/E'))
            assert(id == inst.lookup('id'))
            assert(x == inst.lookup('x'))
        }
        const [e1, e2]: Instance[] = await parseAndEvaluateStatement(`{I339/EF {mode 1, e 10}}`)
        chk(e1, 1, 100); chk(e2, 11, 10)
        const [e3, e4]: Instance[] = await parseAndEvaluateStatement(`{I339/EF {mode 0, e 10}}`)
        chk(e3, 2, 10); chk(e4, 10, 10)
        const es: Instance[] = await parseAndEvaluateStatement(`{I339/E? {}}`)
        assert(es.length == 4)
        let ids = 0
        let xs = 0
        es.forEach((inst: Instance) => {
            ids += inst.lookup('id')
            xs += inst.lookup('x')
        })
        assert(ids == (1 + 11 + 2 + 10))
        assert(xs == (100 + 10 + 10 + 10))
    })
})