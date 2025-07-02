import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';
import { ApplicationSpec, load } from '../../src/runtime/loader.js';
import {
  addBetweenRelationship,
  addContainsRelationship,
  addEntity,
  addModule,
  AttributeSpec,
  Entity,
  fetchModule,
  Instance,
  isInstanceOfType,
  isModule,
  newRelNodeEntry,
  Record,
  removeModule,
  Module,
} from '../../src/runtime/module.js';
import {
  buildGraph,
  findEdgeForRelationship,
  RelationshipGraph,
  RelationshipGraphEdge,
  RelationshipGraphNode,
} from '../../src/runtime/relgraph.js';
import { arrayEquals } from '../../src/runtime/util.js';
import { assert, describe, test } from 'vitest';
import { doInternModule, doPreInit } from '../util.js';
import { PathAttributeName } from '../../src/runtime/defs.js';

function createTestModule(): Module | undefined {
  addModule('Acme');
  try {
    return fetchModule('Acme');
  } catch (err) {
    console.log('ERROR - ' + err);
    return undefined;
  }
}

function addTestRecords(mod: Module) {
  const entry1: Record = new Record('A', 'Acme');
  entry1.addAttribute('x', { type: 'Int' });
  mod.addEntry(entry1);
  const entry2: Entity = new Entity('B', 'Acme');
  const p1: Map<string, any> = new Map();
  p1.set('@id', true);
  const aspec1: AttributeSpec = { type: 'String', properties: p1 };
  entry2.addAttribute('id', aspec1);
  entry2.addAttribute('name', { type: 'String' });
  mod.addEntry(entry2);
  const entry3: Entity = new Entity('C', 'Acme');
  const p2: Map<string, any> = new Map();
  p1.set('@id', true);
  const aspec2: AttributeSpec = { type: 'String', properties: p2 };
  entry3.addAttribute('id', aspec2);
  entry3.addAttribute('age', { type: 'Int' });
  mod.addEntry(entry3);
}

describe('Basic module operations', () => {
  test('check create module', async () => {
    const m: Module | undefined = createTestModule();
    assert(m != undefined, 'Failed to create test module');
    if (m != undefined) {
      assert(m.name == 'Acme', 'Not the expected module`');
      addTestRecords(m);
      assert(arrayEquals(m.getRecordNames(), ['A']), 'Mismatch in record names');
      assert(arrayEquals(m.getEntityNames(), ['B', 'C']), 'Mismatch in entity names');
      m.removeEntry('B');
      assert(arrayEquals(m.getRecordNames(), ['A']), 'Mismatch in record names');
      assert(arrayEquals(m.getEntityNames(), ['C']), 'Failed to remove entity B');
      m.removeEntry('A');
      assert(arrayEquals(m.getRecordNames(), []), 'Failed to remove record A');
      m.removeEntry('C');
      assert(arrayEquals(m.getEntityNames(), []), 'Failed to remove entity C');
    }
  });
});

describe('Basic loader test', () => {
  test('Check loader with graph', async () => {
    await doPreInit()
    await load('example/blog/blog.al').then((appSpec: ApplicationSpec) => {
      assert(appSpec.name, 'Invalid application spec')
      const m: Module = fetchModule('Blog');
      try {
        assert(m.name == 'Blog', 'Failed to load Blog module');
        let re: Record = m.getEntry('UserPost') as Record;
        assert(re != undefined, 'UserPost entry not found');
        const attrs: Set<string> = new Set(['User', 'Post']);
        re.schema.keys().forEach((k: string) => {
          assert(attrs.has(k), `Attribute ${k} not found in UserProfile`);
        });
        assert(re.getUserAttributes().size == 0, 'UserProfile has no user-attributes');
        re = m.getEntry('Post') as Record;
        assert(re.getUserAttributes().size == 2, 'Post has only 2 attributes');
        let g: RelationshipGraph = buildGraph('Blog');
        let obj: any = g.asObject();
        assert(obj['Blog/User'].length == 2, 'Blog/User must have two edges');
        const roots: RelationshipGraphNode[] = g.getRoots();
        assert(roots.length == 3, 'Invalid roots count');
        const node: RelationshipGraphNode = roots[0];
        assert(node.entity.getEntryName() == 'User', 'User not found at root');
        assert(node.edges.length == 2, 'User must have two relationships');
        const relNames: Set<string> = new Set(['UserProfile', 'UserPost']);
        node.edges.forEach((v: RelationshipGraphEdge) => {
          assert(
            relNames.has(v.relationship.name),
            `${v.relationship.name} relationship not found`
          );
        });
        let edge: RelationshipGraphEdge | undefined = findEdgeForRelationship(
          'UserProfile',
          'Blog',
          node.edges
        );
        assert(edge != undefined, 'Edge for UserProfile not found');
        if (edge != undefined) {
          assert(edge.node.entity.getEntryName() == 'Profile', 'Profile not found in relationship');
          assert(edge.node.edges.length == 0, 'Profile does not have relationships');
        }
        edge = findEdgeForRelationship('UserPost', 'Blog', node.edges);
        assert(edge != undefined, 'Edge for UserPost not found');
        if (edge != undefined) {
          assert(edge.node.entity.getEntryName() == 'Post', 'Post not found in relationship');
          assert(edge.node.edges.length == 1, 'POst has exactly one relationships');
          assert(
            edge.node.edges[0].node.entity.getEntryName() == 'Category',
            'Post must be related to Category'
          );
        }
        const testMod: Module = addModule('RelTest1');
        try {
          addEntity('A', testMod.name);
          addEntity('B', testMod.name);
          addBetweenRelationship('R1', m.name, [
            newRelNodeEntry('RelTest/A'),
            newRelNodeEntry('Blog/User'),
          ]);
          addContainsRelationship('R2', m.name, [
            newRelNodeEntry('RelTest/B'),
            newRelNodeEntry('Blog/Category'),
          ]);
          g = buildGraph(m.name);
          obj = g.asObject();
          assert(obj['Blog/User'].length == 2, 'Blog/User must have two edges');
          assert(obj['RelTest/A'].length == 1, 'RelTest/A must have one edge');
          assert(obj['RelTest/A'][0].to['Blog/User'], 'A->User relationship missing');
          assert(obj['RelTest/B'].length == 1, 'RelTest/B must have one edge');
          assert(obj['RelTest/B'][0].to['Blog/Category'], 'B->Profile relationship missing');
        } finally {
          removeModule(testMod.name);
        }
      } finally {
        removeModule(m.name);
      }
    });
  });
});

describe('Basic CRUD tests', () => {
  test('Check CRUD patterns', async () => {
    await doInternModule(`module Blogger
      entity User {
        email Email @id,
        name String
      }
      entity Post {
        id Int @id,
        title String
      }
      relationship UserPost between(User, Post) @one_many
      `)
    assert(isModule('Blogger'), 'Module `Blogger` not found')
    const isUser = (inst: Instance): boolean => {
      return isInstanceOfType(inst, 'Blogger/User')
    }
    const isPost = (inst: Instance): boolean => {
      return isInstanceOfType(inst, 'Blogger/Post')
    }
    const createUser = async (name: string, email: string) => {
      await parseAndEvaluateStatement(`{Blogger/User {email "${email}", name "${name}"}}`)
        .then((result: Instance) => {
          assert(isUser(result), "Failed to create Blogger/User")
        })
    }
    const hasUser = (result: Instance[], email: string) => {
      assert(result.find((inst: Instance) => {
        return inst.attributes.get('email') == email
      }), `Failed to find Blogger/User with email ${email}`)
    }
    const hasPost = (result: Instance[], id: number) => {
      assert(result.find((inst: Instance) => {
        return inst.attributes.get('id') == id
      }), `Failed to find Blogger/Post with id ${id}`)
    }
    await createUser('Joe', 'j@b.com')
    await createUser('Tom', 't@b.com')
    await parseAndEvaluateStatement(`{Blogger/User? {}}`).then((result: Instance[]) => {
      assert(result.length == 2, "Invalid result count")
      assert(result.every(isUser), "Query result is not a Blogger/User")
      hasUser(result, 'j@b.com')
      hasUser(result, 't@b.com')
    })
    const withPosts = async (pat: string, email: string, postIds: number[]) => {
      await parseAndEvaluateStatement(pat).then((result: Instance[]) => {
        assert(result.length == 1, 'Only one Blogger/User expected')
        hasUser(result, email)
        const inst: Instance = result[0]
        const posts = inst.getRelatedInstances('UserPost')
        if (posts) {
          assert(posts.length == postIds.length, `Only ${postIds.length} Blogger/Posts expected, ${posts.length} found`)
          assert(posts.every(isPost), 'Invalid Blogger/Post instance')
          postIds.forEach((id: number) => {
            hasPost(posts, id)
          })
        } else {
          assert(posts, `Blogger/Posts not found for ${email}`)
        }
      })
    }
    let email = "j@b.com"
    let pat = `{Blogger/User {email? "${email}"},
                UserPost [{Blogger/Post {id 1, title "Post One"}}, 
                          {Blogger/Post {id 2, title "Post Two"}}]}`
    await withPosts(pat, email, [1, 2])
    pat = `{Blogger/User {email? "${email}"},
            UserPost {Blogger/Post? {}}}`
    await withPosts(pat, email, [1, 2])
    email = 't@b.com'
    pat = `{Blogger/User {email? "${email}"},
            UserPost [{Blogger/Post {id 3, title "Post Three"}}]}`
    await withPosts(pat, email, [3])
    pat = `{Blogger/User {email? "${email}"},
            UserPost {Blogger/Post? {}}}`
    await withPosts(pat, email, [3])
    const jq = async (email: string) => {
      return await parseAndEvaluateStatement(`{Blogger/User {email? "${email}"}, 
      Blogger/UserPost {Blogger/Post? {}}, 
      into {e Blogger/User.email, t Blogger/Post.title}}`)
    }
    let jr: any[] = await jq(email)
    assert(jr.length == 1)
    assert(jr[0].e == email)
    assert(jr[0].t == 'Post Three')
    email = 'j@b.com'
    jr = await jq(email)
    assert(jr.length == 2)
    assert(jr[0].e == jr[1].e)
    assert(jr[0].e == email)
    assert(jr[0].t == 'Post One' || jr[1].t == 'Post One')
  })
})

describe('Array and one-of tests', () => {
  test('Check array and one-of attribute types', async () => {
    await doInternModule(`module ArrayTest
      entity E {
        id Int @id,
        vals String[],
        x @oneof("123", "456")
      }`)
    assert(isModule('ArrayTest'))
    await parseAndEvaluateStatement(`{ArrayTest/E {id 1, vals ["a", "b"], x "123"}}`)
      .then((result: Instance) => {
        assert(isInstanceOfType(result, 'ArrayTest/E'))
      })
    await parseAndEvaluateStatement(`{ArrayTest/E {id? 1}}`)
      .then((result: Instance[]) => {
        assert(result.length == 1)
        const vals = result[0].lookup('vals')
        assert(vals instanceof Array)
        assert(vals.length == 2)
        assert(vals[1] == 'b')
        assert(result[0].lookup('x') == '123')
      })
    let err = false
    await parseAndEvaluateStatement(`{ArrayTest/E {id 2, vals ["c"], x "678"}}`)
      .catch(() => err = true)
    assert(err == false, 'Failed to enforce one-of check')
  })
})

describe('Default date-time test', () => {
  test('Check date-time', async () => {
    await doInternModule(`module DtTest
      entity E {
        id Int @id,
        dt DateTime @default(now())
      }`)
    assert(isModule('DtTest'))
    let dt = ''
    await parseAndEvaluateStatement(`{DtTest/E {id 1}}`)
      .then((result: Instance) => {
        assert(isInstanceOfType(result, 'DtTest/E'))
        dt = result.lookup('dt')
        assert(dt.indexOf('T') > 0 && dt.endsWith('Z'))
      })
    await parseAndEvaluateStatement(`{DtTest/E {id? 1}}`)
      .then((result: Instance[]) => {
        result[0].lookup('dt') == '2025-06-18T10:51:31.633Z'
      })
  })
})

describe('Map attribute tests', () => {
  test('Check Map attributes', async () => {
    await doInternModule(`module MapTest
      entity E {
        id Int @id,
        v Map
      }`)
    assert(isModule('MapTest'))
    await parseAndEvaluateStatement(`{MapTest/E {id 1, v #{"a": 1, "b": 2}}}`)
      .then((result: Instance) => {
        assert(isInstanceOfType(result, 'MapTest/E'))
      })
    await parseAndEvaluateStatement(`{MapTest/E {id? 1}}`)
      .then((result: Instance[]) => {
        const v = result[0].lookup('v')
        assert(v.get('a') == 1)
      })
  })
})

describe('Expression tests', () => {
  test('Check expression attributes', async () => {
    await doInternModule(`module ExprTest
      entity E {
        id Int @id,
        v Int
      }
      workflow CrE {
          {E {id CrE.id, v CrE.v + 2 * 10}}
      }`)
    assert(isModule('ExprTest'))
    await parseAndEvaluateStatement(`{ExprTest/CrE {id 1, v 10}}`)
      .then((result: Instance) => {
        assert(isInstanceOfType(result, 'ExprTest/E'))
      })
    await parseAndEvaluateStatement(`{ExprTest/E {id? 1}}`)
      .then((result: Instance[]) => {
        const v = result[0].lookup('v')
        assert(v == 30, 'Invalid value for v')
      })
  })
})

describe('Pre-Post trigger tests', () => {
  test('Check pre-post event triggers', async () => {
    await doInternModule(`module PrePostEvents
      entity E {
        id Int @id,
        v Int,
        @after {create AfterCreate},
        @before {delete BeforeDelete}
      }
      entity F {
        id Int @id
        w Int
      }
      workflow CrE {
        {E {id CrE.id, v CrE.v}}
      }
      workflow AfterCreate {
        {F {id AfterCreate.E.id, w AfterCreate.E.v * 10}}
      }
      workflow BeforeDelete {
        delete {F {id? BeforeDelete.E.id}}
      }
     `)
    assert(isModule('PrePostEvents'))
    await parseAndEvaluateStatement(`{PrePostEvents/CrE {id 1, v 10}}`)
      .then((result: Instance) => {
        assert(isInstanceOfType(result, 'PrePostEvents/E'))
      })
    await parseAndEvaluateStatement(`{PrePostEvents/CrE {id 2, v 20}}`)
      .then((result: Instance) => {
        assert(isInstanceOfType(result, 'PrePostEvents/E'))
      })
    await parseAndEvaluateStatement(`{PrePostEvents/F {id? 1}}`)
      .then((result: Instance[]) => {
        assert(result.length == 1)
        assert(isInstanceOfType(result[0], 'PrePostEvents/F'))
        assert(result[0].lookup('w') == 100)
      })
    await parseAndEvaluateStatement(`delete {PrePostEvents/E {id? 1}}`)
    await parseAndEvaluateStatement(`{PrePostEvents/F {id? 1}}`)
      .then((result: Instance[]) => {
        assert(result.length == 0)
      })
    await parseAndEvaluateStatement(`{PrePostEvents/F {id? 2}}`)
      .then((result: Instance[]) => {
        assert(result.length == 1)
        assert(isInstanceOfType(result[0], 'PrePostEvents/F'))
        assert(result[0].lookup('w') == 200)
      })
  })
})

describe('Path reference tests', () => {
  test('Check path references', async () => {
    await doInternModule(`module PathRefs
      entity E {
        id Int @id,
        f Path,
        v Int
      }
      entity F {
        id Int @id,
        w Int
      }
      workflow CrE {
        {E {id CrE.id, f CrE.f, v CrE.f.w * 10}}
      }
     `)
    assert(isModule('PathRefs'))
    let fpath = ''
    await parseAndEvaluateStatement(`{PathRefs/F {id 1, w 2}}`)
      .then((result: Instance) => {
        assert(isInstanceOfType(result, 'PathRefs/F'))
        fpath = result.lookup(PathAttributeName)
      })
    await parseAndEvaluateStatement(`{PathRefs/CrE {id 1, f "${fpath}"}}`)
      .then((result: Instance) => {
        assert(isInstanceOfType(result, 'PathRefs/E'))
        assert(result.lookup('v') == 20)
      })
  })
})

describe('Nested query-into tests', () => {
  test('Check nested into-queries', async () => {
    await doInternModule(`module NestedInto
      entity A {
        id Int @id
        x int
      }
      entity B {
        id Int @id
        y Int
      }
      entity C {
        id Int @id
        z Int
      }
      relationship AB contains(A, B)
      relationship BC contains(B, C)
      `)
    assert(isModule('NestedInto'))
    const isa = ((obj: any) => isInstanceOfType(obj, 'NestedInto/A'))
    const isb = ((obj: any) => isInstanceOfType(obj, 'NestedInto/B'))
    const isc = ((obj: any) => isInstanceOfType(obj, 'NestedInto/C'))
    const cra = async (id: number, x: number) => {
      await parseAndEvaluateStatement(`{NestedInto/A {id ${id}, x ${x}}}`)
        .then((result: any) => {
          assert(isa(result))
        })
    }
    const crb = async (id: number, y: number, aid: number) => {
      await parseAndEvaluateStatement(`{NestedInto/A {id? ${aid}},
        NestedInto/AB {NestedInto/B {id ${id}, y ${y}}}}`)
        .then((results: Instance[]) => {
          assert(results.length == 1)
          const result: Instance = results[0]
          assert(isa(result), 'Not an instance of A')
          const relInsts = result.relatedInstances
          assert(relInsts)
          if (relInsts) {
            const bs = relInsts.get('NestedInto/AB')
            assert(bs)
            if (bs) {
              assert(bs.length > 0)
              bs.forEach((inst: Instance) => {
                assert(isb(inst))
              })
            }
          }
        })
    }
    const crc = async (id: number, z: number, aid: number, bid: number) => {
      await parseAndEvaluateStatement(`{NestedInto/A {id? ${aid}},
        NestedInto/AB {NestedInto/B {id? ${bid}},
                       NestedInto/BC {NestedInto/C {id ${id}, z ${z}}}}}`)
        .then((results: Instance[]) => {
          assert(results.length == 1)
          const result: Instance = results[0]
          assert(isa(result))
          let relInsts = result.relatedInstances
          assert(relInsts)
          if (relInsts) {
            const bs = relInsts.get('NestedInto/AB')
            assert(bs)
            if (bs) {
              assert(bs.length == 1)
              const b: Instance = bs[0]
              assert(isb(b))
              relInsts = b.relatedInstances
              assert(relInsts)
              if (relInsts) {
                const cs = relInsts.get('NestedInto/BC')
                assert(cs)
                if (cs) {
                  assert(cs.length == 1)
                  assert(isc(cs[0]))
                }
              }
            }
          }
        })
    }
    await cra(1, 10)
    await cra(2, 20)
    await crb(10, 100, 1)
    await crb(20, 200, 1)
    await crb(30, 300, 2)
    await crc(100, 1000, 1, 10)
    await crc(200, 2000, 2, 30)
    await crc(300, 3000, 2, 30)
    const f = async (aid: number, check: (value: any) => any) => {
      await parseAndEvaluateStatement(`{NestedInto/A {id? ${aid}},
      NestedInto/AB {NestedInto/B? {},
                     NestedInto/BC {NestedInto/C? {}}},
      into {ax NestedInto/A.x, by NestedInto/B.y, cz NestedInto/C.z}}`)
        .then(check)
    }
    await f(1, (result: any[]) => {
      assert(result.length == 1)
      assert(result[0].ax == 10)
      assert(result[0].by == 100)
      assert(result[0].cz == 1000)
    })
    await f(2, (result: any[]) => {
      assert(result.length == 2)
      assert(result[0].ax == 20)
      assert(result[1].ax == 20)
      assert(result[0].by == 300)
      assert(result[1].by == 300)
      assert(result[0].cz == 2000)
      assert(result[1].cz == 3000)
    })
  })
})