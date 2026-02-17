import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';
import { ApplicationSpec, flushAllAndLoad, load } from '../../src/runtime/loader.js';
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
  newRelNodeEntry,
  Record,
  removeModule,
  Module,
  isModule,
  getAllBetweenRelationshipsForEntity,
  Relationship,
  makeInstance,
  newInstanceAttributes,
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
import { doInternModule, doPreInit, expectError } from '../util.js';
import { testLogger } from '../test-logger.js';
import { PathAttributeName } from '../../src/runtime/defs.js';
import { FlowStepPattern } from '../../src/language/syntax.js';

function createTestModule(): Module | undefined {
  addModule('Acme');
  try {
    return fetchModule('Acme');
  } catch (err) {
    testLogger.verboseError('ERROR - ' + err);
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
    assert(m !== undefined, 'Failed to create test module');
    if (m !== undefined) {
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
  test('test01', async () => {
    await doPreInit();
    await load('example/blog/src/blog.al').then((appSpec: ApplicationSpec) => {
      assert(appSpec.name, 'Invalid application spec');
      const m: Module = fetchModule('Blog.Core');
      try {
        assert(m.name == 'Blog.Core', 'Failed to load Blog module');
        let re: Record = m.getEntry('UserPost') as Record;
        assert(re !== undefined, 'UserPost entry not found');
        const attrs: Set<string> = new Set(['User', 'Post']);
        // Convert iterator to array for compatibility with Node.js 20.x
        Array.from(re.schema.keys()).forEach((k: string) => {
          assert(attrs.has(k), `Attribute ${k} not found in UserProfile`);
        });
        assert(re.getUserAttributes().size == 0, 'UserProfile has no user-attributes');
        re = m.getEntry('Post') as Record;
        assert(re.getUserAttributes().size == 2, 'Post has only 2 attributes');
        let g: RelationshipGraph = buildGraph('Blog.Core');
        let obj: any = g.asObject();
        assert(obj['Blog.Core/User'].length == 2, 'Blog.Core/User must have two edges');
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
          'Blog.Core',
          node.edges
        );
        assert(edge !== undefined, 'Edge for UserProfile not found');
        if (edge !== undefined) {
          assert(edge.node.entity.getEntryName() == 'Profile', 'Profile not found in relationship');
          assert(edge.node.edges.length == 0, 'Profile does not have relationships');
        }
        edge = findEdgeForRelationship('UserPost', 'Blog.Core', node.edges);
        assert(edge !== undefined, 'Edge for UserPost not found');
        if (edge !== undefined) {
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
            newRelNodeEntry('Blog.Core/User'),
          ]);
          addContainsRelationship('R2', m.name, [
            newRelNodeEntry('RelTest/B'),
            newRelNodeEntry('Blog.Core/Category'),
          ]);
          g = buildGraph(m.name);
          obj = g.asObject();
          assert(obj['Blog.Core/User'].length == 2, 'Blog.Core/User must have two edges');
          assert(obj['RelTest/A'].length == 1, 'RelTest/A must have one edge');
          assert(obj['RelTest/A'][0].to['Blog.Core/User'], 'A->User relationship missing');
          assert(obj['RelTest/B'].length == 1, 'RelTest/B must have one edge');
          assert(obj['RelTest/B'][0].to['Blog.Core/Category'], 'B->Profile relationship missing');
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
  test('test01', async () => {
    await doInternModule(
      'Blogger',
      `entity User {
        email Email @id,
        name String
      }
      entity Post {
        id Int @id,
        title String
      }
      relationship UserPost between(User, Post) @one_many
      `
    );
    const isUser = (inst: Instance): boolean => {
      return isInstanceOfType(inst, 'Blogger/User');
    };
    const isPost = (inst: Instance): boolean => {
      return isInstanceOfType(inst, 'Blogger/Post');
    };
    const createUser = async (name: string, email: string) => {
      await parseAndEvaluateStatement(`{Blogger/User {email "${email}", name "${name}"}}`).then(
        (result: Instance) => {
          assert(isUser(result), 'Failed to create Blogger/User');
        }
      );
    };
    const hasUser = (result: Instance[], email: string) => {
      assert(
        result.find((inst: Instance) => {
          return inst.attributes.get('email') == email;
        }),
        `Failed to find Blogger/User with email ${email}`
      );
    };
    const hasPost = (result: Instance[], id: number) => {
      assert(
        result.find((inst: Instance) => {
          return inst.attributes.get('id') == id;
        }),
        `Failed to find Blogger/Post with id ${id}`
      );
    };
    await createUser('Joe', 'j@b.com');
    await createUser('Tom', 't@b.com');
    await parseAndEvaluateStatement(`{Blogger/User? {}}`).then((result: Instance[]) => {
      assert(result.length == 2, 'Invalid result count');
      assert(result.every(isUser), 'Query result is not a Blogger/User');
      hasUser(result, 'j@b.com');
      hasUser(result, 't@b.com');
    });
    const withPosts = async (pat: string, email: string, postIds: number[]) => {
      await parseAndEvaluateStatement(pat).then((result: Instance[]) => {
        assert(result.length == 1, 'Only one Blogger/User expected');
        hasUser(result, email);
        const inst: Instance = result[0];
        const posts = inst.getRelatedInstances('UserPost');
        if (posts) {
          assert(
            posts.length == postIds.length,
            `Only ${postIds.length} Blogger/Posts expected, ${posts.length} found`
          );
          assert(posts.every(isPost), 'Invalid Blogger/Post instance');
          postIds.forEach((id: number) => {
            hasPost(posts, id);
          });
        } else {
          assert(posts, `Blogger/Posts not found for ${email}`);
        }
      });
    };
    let email = 'j@b.com';
    let pat = `{Blogger/User {email? "${email}"},
                UserPost [{Blogger/Post {id 1, title "Post One"}}, 
                          {Blogger/Post {id 2, title "Post Two"}}]}`;
    await withPosts(pat, email, [1, 2]);
    pat = `{Blogger/User {email? "${email}"},
            UserPost {Blogger/Post? {}}}`;
    await withPosts(pat, email, [1, 2]);
    email = 't@b.com';
    pat = `{Blogger/User {email? "${email}"},
            UserPost [{Blogger/Post {id 3, title "Post Three"}}]}`;
    await withPosts(pat, email, [3]);
    pat = `{Blogger/User {email? "${email}"},
            UserPost {Blogger/Post? {}}}`;
    await withPosts(pat, email, [3]);
    const jq = async (email: string) => {
      return await parseAndEvaluateStatement(`{Blogger/User {email? "${email}"}, 
      Blogger/UserPost {Blogger/Post? {}}, 
      @into {e Blogger/User.email, t Blogger/Post.title}}`);
    };
    let jr: any[] = await jq(email);
    assert(jr.length == 1);
    assert(jr[0].e == email);
    assert(jr[0].t == 'Post Three');
    email = 'j@b.com';
    jr = await jq(email);
    assert(jr.length == 2);
    assert(jr[0].e == jr[1].e);
    assert(jr[0].e == email);
    assert(jr[0].t == 'Post One' || jr[1].t == 'Post One');
  });
});

describe('Array, enum and oneof tests', () => {
  test('test01', async () => {
    await doInternModule(
      'ArrayTest',
      `entity E {
        id Int @id,
        vals String[],
        x @enum("123", "456"),
        y @oneof(ArrayTest/F.v)
      }
      entity F { v String @id }
      `
    );
    const crf = async (v: string) => {
      const inst: Instance = await parseAndEvaluateStatement(`{ArrayTest/F {v "${v}"}}`);
      assert(isInstanceOfType(inst, 'ArrayTest/F'));
    };
    await crf('a');
    await crf('b');
    await parseAndEvaluateStatement(`{ArrayTest/E {id 1, vals ["a", "b"], x "123", y "a"}}`).then(
      (result: Instance) => {
        assert(isInstanceOfType(result, 'ArrayTest/E'));
      }
    );
    await parseAndEvaluateStatement(`{ArrayTest/E {id? 1}}`).then((result: Instance[]) => {
      assert(result.length == 1);
      const vals = result[0].lookup('vals');
      assert(vals instanceof Array);
      assert(vals.length == 2);
      assert(vals[1] == 'b');
      assert(result[0].lookup('x') == '123');
      assert(result[0].lookup('y') == 'a');
    });
    let err = false;
    await parseAndEvaluateStatement(`{ArrayTest/E {id 2, vals ["c"], x "678", y "b"}}`).catch(
      () => (err = true)
    );
    assert(err, 'Failed to enforce enum check');
    err = false;
    await parseAndEvaluateStatement(`{ArrayTest/E {id 2, vals ["c"], x "456", y "c"}}`).catch(
      () => (err = true)
    );
    assert(err, 'Failed to enforce oneof check');
    await parseAndEvaluateStatement(`{ArrayTest/E {id 2, vals ["c"], x "456", y "b"}}`).then(
      (result: Instance) => {
        assert(isInstanceOfType(result, 'ArrayTest/E'));
      }
    );
  });
});

describe('Default date-time test', () => {
  test('test01', async () => {
    await doInternModule(
      'DtTest',
      `entity E {
        id Int @id,
        dt DateTime @default(now())
      }`
    );
    let dt = '';
    await parseAndEvaluateStatement(`{DtTest/E {id 1}}`).then((result: Instance) => {
      assert(isInstanceOfType(result, 'DtTest/E'));
      dt = result.lookup('dt');
      assert(dt.indexOf('T') > 0 && dt.endsWith('Z'));
    });
    await parseAndEvaluateStatement(`{DtTest/E {id? 1}}`).then((result: Instance[]) => {
      result[0].lookup('dt') == '2025-06-18T10:51:31.633Z';
    });
  });
});

describe('Map attribute tests', () => {
  test('test01', async () => {
    await doInternModule(
      'MapTest',
      `entity E {
        id Int @id,
        v Map
      }`
    );
    await parseAndEvaluateStatement(`{MapTest/E {id 1, v {"a": 1, "b": 2}}}`).then(
      (result: Instance) => {
        assert(isInstanceOfType(result, 'MapTest/E'));
      }
    );
    await parseAndEvaluateStatement(`{MapTest/E {id? 1}}`).then((result: Instance[]) => {
      const v = result[0].lookup('v');
      assert(v['a'] == 1);
    });
  });
});

describe('Expression tests', () => {
  test('test01', async () => {
    await doInternModule(
      'ExprTest',
      `entity E {
        id Int @id,
        v Int
      }
      workflow CrE {
          {E {id CrE.id, v CrE.v + 2 * 10}}
      }`
    );
    await parseAndEvaluateStatement(`{ExprTest/CrE {id 1, v 10}}`).then((result: Instance) => {
      assert(isInstanceOfType(result, 'ExprTest/E'));
    });
    await parseAndEvaluateStatement(`{ExprTest/E {id? 1}}`).then((result: Instance[]) => {
      const v = result[0].lookup('v');
      assert(v == 30, 'Invalid value for v');
    });
  });
});

describe('Pre-Post trigger tests', () => {
  test('test01', async () => {
    await doInternModule(
      'PrePostEvents',
      `entity E {
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
      workflow @after update:E {
        {F {id? this.id, w PrePostEvents/E.v * 100}}
      }
      workflow BeforeDelete {
        delete {F {id? BeforeDelete.E.id}}
      }
     `
    );
    const m = fetchModule('PrePostEvents');
    const events = m.getEventNames();
    let c = 0;
    events.forEach((n: string) => {
      if (m.isPrePostEvent(n)) ++c;
    });
    assert(c == 1);
    await parseAndEvaluateStatement(`{PrePostEvents/CrE {id 1, v 10}}`).then((result: Instance) => {
      assert(isInstanceOfType(result, 'PrePostEvents/E'));
    });
    await parseAndEvaluateStatement(`{PrePostEvents/CrE {id 2, v 20}}`).then((result: Instance) => {
      assert(isInstanceOfType(result, 'PrePostEvents/E'));
    });
    await parseAndEvaluateStatement(`{PrePostEvents/F {id? 1}}`).then((result: Instance[]) => {
      assert(result.length == 1);
      assert(isInstanceOfType(result[0], 'PrePostEvents/F'));
      assert(result[0].lookup('w') == 100);
    });
    await parseAndEvaluateStatement(`delete {PrePostEvents/E {id? 1}}`);
    await parseAndEvaluateStatement(`{PrePostEvents/F {id? 1}}`).then((result: Instance[]) => {
      assert(result.length == 0);
    });
    await parseAndEvaluateStatement(`{PrePostEvents/F {id? 2}}`).then((result: Instance[]) => {
      assert(result.length == 1);
      assert(isInstanceOfType(result[0], 'PrePostEvents/F'));
      assert(result[0].lookup('w') == 200);
    });
    await parseAndEvaluateStatement(`{PrePostEvents/E {id? 2, v 30}}`).then(
      (result: Instance[]) => {
        assert(result.length == 1);
        assert(isInstanceOfType(result[0], 'PrePostEvents/E'));
        assert(result[0].lookup('v') == 30);
      }
    );
    await parseAndEvaluateStatement(`{PrePostEvents/F {id? 2}}`).then((result: Instance[]) => {
      assert(result.length == 1);
      assert(isInstanceOfType(result[0], 'PrePostEvents/F'));
      assert(result[0].lookup('w') == 3000);
    });
  });
});

describe('Path reference tests', () => {
  test('test01', async () => {
    await doInternModule(
      'PathRefs',
      `entity E {
        id Int @id,
        f @ref(PathRefs/F),
        v Int
      }
      entity F {
        id Int @id,
        w Int
      }
      workflow CrE {
        {E {id CrE.id, f CrE.f, v CrE.f.w * 10}}
      }
     `
    );
    let fpath = '';
    await parseAndEvaluateStatement(`{PathRefs/F {id 1, w 2}}`).then((result: Instance) => {
      assert(isInstanceOfType(result, 'PathRefs/F'));
      fpath = result.lookup(PathAttributeName);
    });
    await parseAndEvaluateStatement(`{PathRefs/CrE {id 1, f "${fpath}"}}`).then(
      (result: Instance) => {
        assert(isInstanceOfType(result, 'PathRefs/E'));
        assert(result.lookup('v') == 20);
      }
    );
  });
});

describe('Nested query-into tests', () => {
  test('test01', async () => {
    await doInternModule(
      'NestedInto',
      `entity A {
        id Int @id
        x Int
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
      `
    );
    const isa = (obj: any) => isInstanceOfType(obj, 'NestedInto/A');
    const isb = (obj: any) => isInstanceOfType(obj, 'NestedInto/B');
    const isc = (obj: any) => isInstanceOfType(obj, 'NestedInto/C');
    const cra = async (id: number, x: number) => {
      await parseAndEvaluateStatement(`{NestedInto/A {id ${id}, x ${x}}}`).then((result: any) => {
        assert(isa(result));
      });
    };
    const crb = async (id: number, y: number, aid: number) => {
      await parseAndEvaluateStatement(`{NestedInto/A {id? ${aid}},
        NestedInto/AB {NestedInto/B {id ${id}, y ${y}}}}`).then((results: Instance[]) => {
        assert(results.length == 1);
        const result: Instance = results[0];
        assert(isa(result), 'Not an instance of A');
        const relInsts = result.relatedInstances;
        assert(relInsts);
        if (relInsts) {
          const bs = relInsts.get('NestedInto/AB');
          assert(bs);
          if (bs) {
            assert(bs.length > 0);
            bs.forEach((inst: Instance) => {
              assert(isb(inst));
            });
          }
        }
      });
    };
    const crc = async (id: number, z: number, aid: number, bid: number) => {
      await parseAndEvaluateStatement(`{NestedInto/A {id? ${aid}},
        NestedInto/AB {NestedInto/B {id? ${bid}},
                       NestedInto/BC {NestedInto/C {id ${id}, z ${z}}}}}`).then(
        (results: Instance[]) => {
          assert(results.length == 1);
          const result: Instance = results[0];
          assert(isa(result));
          let relInsts = result.relatedInstances;
          assert(relInsts);
          if (relInsts) {
            const bs = relInsts.get('NestedInto/AB');
            assert(bs);
            if (bs) {
              assert(bs.length == 1);
              const b: Instance = bs[0];
              assert(isb(b));
              relInsts = b.relatedInstances;
              assert(relInsts);
              if (relInsts) {
                const cs = relInsts.get('NestedInto/BC');
                assert(cs);
                if (cs) {
                  assert(cs.length == 1);
                  assert(isc(cs[0]));
                }
              }
            }
          }
        }
      );
    };
    await cra(1, 10);
    await cra(2, 20);
    await crb(10, 100, 1);
    await crb(20, 200, 1);
    await crb(30, 300, 2);
    await crc(100, 1000, 1, 10);
    await crc(200, 2000, 2, 30);
    await crc(300, 3000, 2, 30);
    const f = async (aid: number, check: (value: any) => any) => {
      await parseAndEvaluateStatement(`{NestedInto/A {id? ${aid}},
      NestedInto/AB {NestedInto/B? {},
                     NestedInto/BC {NestedInto/C? {}}},
      @into {ax NestedInto/A.x, by NestedInto/B.y, cz NestedInto/C.z}}`).then(check);
    };
    await f(1, (result: any[]) => {
      assert(result.length == 1);
      assert(result[0].ax == 10);
      assert(result[0].by == 100);
      assert(result[0].cz == 1000);
    });
    await f(2, (result: any[]) => {
      assert(result.length == 2);
      assert(result[0].ax == 20);
      assert(result[1].ax == 20);
      assert(result[0].by == 300);
      assert(result[1].by == 300);
      assert(result[0].cz == 2000);
      assert(result[1].cz == 3000);
    });
  });
});

describe('Multiple module loading tests', () => {
  test('test01', async () => {
    await doPreInit();

    try {
      // Load Blog module first
      await load('example/blog/src/blog.al').then(async (appSpec: ApplicationSpec) => {
        assert(appSpec.name, 'Invalid Blog application spec');
        const blogModule: Module = fetchModule('Blog.Core');
        assert(blogModule.name == 'Blog.Core', 'Failed to load Blog.Core module');
        assert(blogModule.hasEntry('User'), 'Blog module missing User entity');
        assert(blogModule.hasEntry('Post'), 'Blog module missing Post entity');

        // Load second module and verify if Blog is still accessible
        await flushAllAndLoad('example/pets/src/core.al').then(async (appSpec: ApplicationSpec) => {
          assert(appSpec.name, 'Invalid application spec');
          const m: Module = fetchModule('pets.core');
          assert(m.name == 'pets.core', 'Failed to load pets.core module');
          assert(m.hasEntry('createPet'), 'pets.core module missing createPet');

          // Critical test: Blog module should not still be accessible after Family load
          assert(!isModule('Blog.Core'), 'Blog.Core module not removed before pets.core load');
          assert(isModule('pets.core'), 'pets.core module not registered');

          removeModule('pets.core');
          assert(!isModule('pets.core'), 'pets.core module not removed');
        });
      });
    } finally {
      try {
        removeModule('Blog.Core');
      } catch {}
      try {
        removeModule('Family');
      } catch {}
    }
  });
});

describe('Catch test', () => {
  test('test01', async () => {
    await doInternModule(
      'Catch',
      `entity E {
        id Int @id,
        x Int
      }`
    );
    const chk = (result: Instance) => {
      assert(isInstanceOfType(result, 'Catch/E'));
      assert(result.lookup('x') == 100);
    };
    await parseAndEvaluateStatement(`{Catch/E {id? 1}} @as [E]
                                        @catch {not_found {Catch/E {id 1, x 100}}
                                                error {Catch/E {id -1, x -1}}}`).then(chk);
    await parseAndEvaluateStatement(`{Catch/E {id? 1}} @as [E]`).then((result: Instance[]) =>
      chk(result[0])
    );
  });
});

describe('Empty hint test', () => {
  test('test01', async () => {
    await doInternModule('Empty', `entity E { id Int @id, x Int }`);
    // Create a default record
    await parseAndEvaluateStatement(`{Empty/E {id 99, x 200}}`);
    // Query non-existent record, fallback to default
    const result = await parseAndEvaluateStatement(
      `{Empty/E {id? 1}} @empty {Empty/E {id? 99}} @as [E]`
    );
    assert(result instanceof Array);
    assert(result.length > 0);
    assert(isInstanceOfType(result[0], 'Empty/E'));
    assert(result[0].lookup('x') == 200);
  });

  test('empty does not fire when query returns results', async () => {
    await doInternModule('EmptyNoFire', `entity E { id Int @id, x Int }`);
    await parseAndEvaluateStatement(`{EmptyNoFire/E {id 1, x 100}}`);
    // Query for an existing record - @empty should NOT fire
    const result = await parseAndEvaluateStatement(
      `{EmptyNoFire/E {id? 1}} @empty {EmptyNoFire/E {id 99, x 999}} @as [E]`
    );
    assert(result instanceof Array);
    assert(result.length == 1);
    assert(result[0].lookup('id') == 1);
    assert(result[0].lookup('x') == 100);
  });

  test('empty with create fallback', async () => {
    await doInternModule('EmptyCr', `entity E { id Int @id, x Int }`);
    // Query for non-existent record, @empty creates a new one.
    // Create operations return a single Instance (not an array),
    // so @as binds the single Instance to E.
    const result = await parseAndEvaluateStatement(
      `{EmptyCr/E {id? 1}} @empty {EmptyCr/E {id 1, x 500}} @as E`
    );
    assert(isInstanceOfType(result, 'EmptyCr/E'));
    assert(result.lookup('x') == 500);
    // Verify the created record persists
    const check: Instance[] = await parseAndEvaluateStatement(`{EmptyCr/E {id? 1}}`);
    assert(check.length == 1);
    assert(check[0].lookup('x') == 500);
  });
});

describe('Query result shape consistency', () => {
  test('query always returns array', async () => {
    await doInternModule('QShape', `entity E { id Int @id, x Int }`);
    // Empty query returns empty array
    const empty: Instance[] = await parseAndEvaluateStatement(`{QShape/E {id? 1}}`);
    assert(empty instanceof Array);
    assert(empty.length == 0);
    // Create one record
    await parseAndEvaluateStatement(`{QShape/E {id 1, x 10}}`);
    // Single result still returns array
    const single: Instance[] = await parseAndEvaluateStatement(`{QShape/E {id? 1}}`);
    assert(single instanceof Array);
    assert(single.length == 1);
    assert(single[0].lookup('x') == 10);
    // Multiple results return array
    await parseAndEvaluateStatement(`{QShape/E {id 2, x 20}}`);
    const multi: Instance[] = await parseAndEvaluateStatement(`{QShape/E? {}}`);
    assert(multi instanceof Array);
    assert(multi.length == 2);
  });

  test('read-for-update single result returns array', async () => {
    await doInternModule('QUpd', `entity E { id Int @id, x Int }`);
    await parseAndEvaluateStatement(`{QUpd/E {id 1, x 10}}`);
    await parseAndEvaluateStatement(`{QUpd/E {id 2, x 20}}`);
    // Update single match via query - should return array
    const updated: Instance[] = await parseAndEvaluateStatement(`{QUpd/E {id? 1, x 99}}`);
    assert(updated instanceof Array);
    assert(updated.length == 1);
    assert(updated[0].lookup('x') == 99);
    // Verify the other record is untouched
    const other: Instance[] = await parseAndEvaluateStatement(`{QUpd/E {id? 2}}`);
    assert(other instanceof Array);
    assert(other.length == 1);
    assert(other[0].lookup('x') == 20);
  });

  test('read-for-update multiple results returns array', async () => {
    await doInternModule('QUpdM', `entity E { id Int @id, x Int, y Int }`);
    await parseAndEvaluateStatement(`{QUpdM/E {id 1, x 10, y 1}}`);
    await parseAndEvaluateStatement(`{QUpdM/E {id 2, x 10, y 2}}`);
    await parseAndEvaluateStatement(`{QUpdM/E {id 3, x 30, y 3}}`);
    // Update all records where x=10 - should return array of updated instances
    const updated: Instance[] = await parseAndEvaluateStatement(`{QUpdM/E {x? 10, y 99}}`);
    assert(updated instanceof Array);
    assert(updated.length == 2);
    assert(updated.every((inst: Instance) => inst.lookup('y') == 99));
    // Verify the non-matching record is untouched
    const other: Instance[] = await parseAndEvaluateStatement(`{QUpdM/E {id? 3}}`);
    assert(other[0].lookup('y') == 3);
  });

  test('read-for-update no match returns empty array', async () => {
    await doInternModule('QUpdE', `entity E { id Int @id, x Int }`);
    await parseAndEvaluateStatement(`{QUpdE/E {id 1, x 10}}`);
    // Update with non-matching query - should return empty array
    const updated: Instance[] = await parseAndEvaluateStatement(`{QUpdE/E {id? 999, x 99}}`);
    assert(updated instanceof Array);
    assert(updated.length == 0);
    // Verify existing record is untouched
    const check: Instance[] = await parseAndEvaluateStatement(`{QUpdE/E {id? 1}}`);
    assert(check[0].lookup('x') == 10);
  });

  test('query-all returns array', async () => {
    await doInternModule('QAll', `entity E { id Int @id, x Int }`);
    // Query-all on empty table returns empty array
    const empty: Instance[] = await parseAndEvaluateStatement(`{QAll/E? {}}`);
    assert(empty instanceof Array);
    assert(empty.length == 0);
    await parseAndEvaluateStatement(`{QAll/E {id 1, x 10}}`);
    await parseAndEvaluateStatement(`{QAll/E {id 2, x 20}}`);
    await parseAndEvaluateStatement(`{QAll/E {id 3, x 30}}`);
    const all: Instance[] = await parseAndEvaluateStatement(`{QAll/E? {}}`);
    assert(all instanceof Array);
    assert(all.length == 3);
  });
});

describe('Between relationship query result shape', () => {
  test('query via between relationship returns array', async () => {
    await doInternModule(
      'BetQ',
      `entity Author {
        id Int @id,
        name String
      }
      entity Book {
        id Int @id,
        title String
      }
      relationship AuthorBook between(Author, Book) @one_many

      workflow LinkAuthorBook {
        {BetQ/Author {id? LinkAuthorBook.authorId}} @as [A]
        {BetQ/Book {id? LinkAuthorBook.bookId}} @as [B]
        {BetQ/AuthorBook {Author A, Book B}}
      }
      `
    );
    await parseAndEvaluateStatement(`{BetQ/Author {id 1, name "Alice"}}`);
    await parseAndEvaluateStatement(`{BetQ/Book {id 10, title "Book A"}}`);
    await parseAndEvaluateStatement(`{BetQ/Book {id 20, title "Book B"}}`);
    // Link via workflow
    await parseAndEvaluateStatement(`{BetQ/LinkAuthorBook {authorId 1, bookId 10}}`);
    await parseAndEvaluateStatement(`{BetQ/LinkAuthorBook {authorId 1, bookId 20}}`);
    // Query author with related books
    const result: Instance[] = await parseAndEvaluateStatement(
      `{BetQ/Author {id? 1},
       BetQ/AuthorBook {BetQ/Book? {}}}`
    );
    assert(result instanceof Array);
    assert(result.length == 1);
    assert(isInstanceOfType(result[0], 'BetQ/Author'));
    const books = result[0].getRelatedInstances('BetQ/AuthorBook');
    assert(books && books.length == 2);
  });

  test('between relationship query with no results returns empty array', async () => {
    await doInternModule(
      'BetQE',
      `entity Parent {
        id Int @id,
        name String
      }
      entity Child {
        id Int @id,
        label String
      }
      relationship PC between(Parent, Child) @one_many
      `
    );
    await parseAndEvaluateStatement(`{BetQE/Parent {id 1, name "p1"}}`);
    // Query for parent with children when none linked
    const result: Instance[] = await parseAndEvaluateStatement(
      `{BetQE/Parent {id? 1},
       BetQE/PC {BetQE/Child? {}}}`
    );
    assert(result instanceof Array);
    assert(result.length == 1);
    const children = result[0].getRelatedInstances('BetQE/PC');
    assert(!children || children.length == 0);
  });

  test('between relationship query with @into returns array', async () => {
    await doInternModule(
      'BetQI',
      `entity Resource {
        id Int @id,
        name String
      }
      entity Task {
        id Int @id,
        description String
      }
      relationship ResTask between(Resource, Task) @one_many

      workflow FetchResourceTasks {
        {BetQI/Resource {id? FetchResourceTasks.id},
         BetQI/ResTask {BetQI/Task? {}},
         @into {rname BetQI/Resource.name, tdesc BetQI/Task.description}}
      }
      `
    );
    await parseAndEvaluateStatement(`{BetQI/Resource {id 1, name "r1"}}`);
    // Create tasks linked to resource via relationship pattern
    await parseAndEvaluateStatement(
      `{BetQI/Resource {id? 1},
       BetQI/ResTask {BetQI/Task {id 10, description "task_a"}}}`
    );
    await parseAndEvaluateStatement(
      `{BetQI/Resource {id? 1},
       BetQI/ResTask {BetQI/Task {id 20, description "task_b"}}}`
    );
    // Query via workflow with @into
    const result: any[] = await parseAndEvaluateStatement(`{BetQI/FetchResourceTasks {id 1}}`);
    assert(result instanceof Array);
    assert(result.length == 2);
    assert(result.every((r: any) => r.rname == 'r1'));
    const descs = result.map((r: any) => r.tdesc).sort();
    assert(descs[0] == 'task_a' && descs[1] == 'task_b');
  });

  test('reverse between relationship query returns array', async () => {
    await doInternModule(
      'BetQR',
      `entity Manager {
        id Int @id,
        name String
      }
      entity Employee {
        id Int @id,
        name String
      }
      relationship MgrEmp between(Manager, Employee) @one_many

      workflow LinkMgrEmp {
        {BetQR/Manager {id? LinkMgrEmp.mgrId}} @as [M]
        {BetQR/Employee {id? LinkMgrEmp.empId}} @as [E]
        {BetQR/MgrEmp {Manager M, Employee E}}
      }

      workflow FindEmployeeManager {
        {BetQR/Employee {id? FindEmployeeManager.id},
         BetQR/MgrEmp {BetQR/Manager? {}},
         @into {ename BetQR/Employee.name, mname BetQR/Manager.name}}
      }
      `
    );
    await parseAndEvaluateStatement(`{BetQR/Manager {id 1, name "boss"}}`);
    await parseAndEvaluateStatement(`{BetQR/Employee {id 10, name "worker"}}`);
    await parseAndEvaluateStatement(`{BetQR/LinkMgrEmp {mgrId 1, empId 10}}`);
    // Reverse query: from employee find manager
    const result: any[] = await parseAndEvaluateStatement(`{BetQR/FindEmployeeManager {id 10}}`);
    assert(result instanceof Array);
    assert(result.length == 1);
    assert(result[0].ename == 'worker');
    assert(result[0].mname == 'boss');
  });
});

describe('Contains relationship query result shape', () => {
  test('contains query returns array', async () => {
    await doInternModule(
      'ContQ',
      `entity Dept {
        id Int @id,
        name String
      }
      entity Staff {
        id Int @id,
        name String
      }
      relationship DeptStaff contains(Dept, Staff)
      `
    );
    await parseAndEvaluateStatement(`{ContQ/Dept {id 1, name "engineering"}}`);
    // Create staff under department
    await parseAndEvaluateStatement(
      `{ContQ/Dept {id? 1},
       ContQ/DeptStaff {ContQ/Staff {id 10, name "alice"}}}`
    );
    await parseAndEvaluateStatement(
      `{ContQ/Dept {id? 1},
       ContQ/DeptStaff {ContQ/Staff {id 20, name "bob"}}}`
    );
    // Query dept with staff
    const result: Instance[] = await parseAndEvaluateStatement(
      `{ContQ/Dept {id? 1},
       ContQ/DeptStaff {ContQ/Staff? {}}}`
    );
    assert(result instanceof Array);
    assert(result.length == 1);
    assert(isInstanceOfType(result[0], 'ContQ/Dept'));
    const staff = result[0].getRelatedInstances('ContQ/DeptStaff');
    assert(staff && staff.length == 2);
  });

  test('contains query with @into returns array', async () => {
    await doInternModule(
      'ContQI',
      `entity Folder {
        id Int @id,
        name String
      }
      entity Doc {
        id Int @id,
        title String
      }
      relationship FolderDoc contains(Folder, Doc)

      workflow ListDocs {
        {ContQI/Folder {id? ListDocs.folderId},
         ContQI/FolderDoc {ContQI/Doc? {}},
         @into {folder ContQI/Folder.name, doc ContQI/Doc.title}}
      }
      `
    );
    await parseAndEvaluateStatement(`{ContQI/Folder {id 1, name "root"}}`);
    await parseAndEvaluateStatement(
      `{ContQI/Folder {id? 1},
       ContQI/FolderDoc {ContQI/Doc {id 10, title "readme"}}}`
    );
    await parseAndEvaluateStatement(
      `{ContQI/Folder {id? 1},
       ContQI/FolderDoc {ContQI/Doc {id 20, title "notes"}}}`
    );
    const result: any[] = await parseAndEvaluateStatement(`{ContQI/ListDocs {folderId 1}}`);
    assert(result instanceof Array);
    assert(result.length == 2);
    assert(result.every((r: any) => r.folder == 'root'));
    const titles = result.map((r: any) => r.doc).sort();
    assert(titles[0] == 'notes' && titles[1] == 'readme');
  });

  test('nested contains query with @into returns array', async () => {
    await doInternModule(
      'NestC',
      `entity Org {
        id Int @id,
        name String
      }
      entity Team {
        id Int @id,
        label String
      }
      entity Member {
        id Int @id,
        who String
      }
      relationship OrgTeam contains(Org, Team)
      relationship TeamMember contains(Team, Member)
      `
    );
    await parseAndEvaluateStatement(`{NestC/Org {id 1, name "acme"}}`);
    await parseAndEvaluateStatement(
      `{NestC/Org {id? 1},
       NestC/OrgTeam {NestC/Team {id 10, label "alpha"}}}`
    );
    await parseAndEvaluateStatement(
      `{NestC/Org {id? 1},
       NestC/OrgTeam {NestC/Team {id? 10},
                      NestC/TeamMember {NestC/Member {id 100, who "alice"}}}}`
    );
    await parseAndEvaluateStatement(
      `{NestC/Org {id? 1},
       NestC/OrgTeam {NestC/Team {id? 10},
                      NestC/TeamMember {NestC/Member {id 200, who "bob"}}}}`
    );
    // Nested query with @into across 3 levels
    const result: any[] = await parseAndEvaluateStatement(
      `{NestC/Org {id? 1},
       NestC/OrgTeam {NestC/Team? {},
                      NestC/TeamMember {NestC/Member? {}}},
       @into {org NestC/Org.name, team NestC/Team.label, member NestC/Member.who}}`
    );
    assert(result instanceof Array);
    assert(result.length == 2);
    assert(result.every((r: any) => r.org == 'acme' && r.team == 'alpha'));
    const members = result.map((r: any) => r.member).sort();
    assert(members[0] == 'alice' && members[1] == 'bob');
  });
});

describe('Join query result shape', () => {
  test('simple @join returns array', async () => {
    await doInternModule(
      'JoinQ',
      `entity Order {
        id Int @id,
        customerId Int,
        amount Decimal
      }
      entity Customer {
        id Int @id,
        customerId Int,
        name String
      }

      workflow OrderSummary {
        {JoinQ/Order? {},
         @join JoinQ/Customer {customerId? JoinQ/Order.customerId},
         @into {orderId JoinQ/Order.id, customerName JoinQ/Customer.name, amount JoinQ/Order.amount}}
      }
      `
    );
    await parseAndEvaluateStatement(`{JoinQ/Customer {id 1, customerId 100, name "Alice"}}`);
    await parseAndEvaluateStatement(`{JoinQ/Customer {id 2, customerId 200, name "Bob"}}`);
    await parseAndEvaluateStatement(`{JoinQ/Order {id 1, customerId 100, amount 50.0}}`);
    await parseAndEvaluateStatement(`{JoinQ/Order {id 2, customerId 100, amount 75.0}}`);
    await parseAndEvaluateStatement(`{JoinQ/Order {id 3, customerId 200, amount 30.0}}`);

    const result: any[] = await parseAndEvaluateStatement(`{JoinQ/OrderSummary {}}`);
    assert(result instanceof Array);
    assert(result.length == 3);
    const aliceOrders = result.filter((r: any) => r.customerName == 'Alice');
    assert(aliceOrders.length == 2);
    const bobOrders = result.filter((r: any) => r.customerName == 'Bob');
    assert(bobOrders.length == 1);
    assert(bobOrders[0].amount == 30.0);
  });

  test('@join with no matching rows returns empty array', async () => {
    await doInternModule(
      'JoinQE',
      `entity Item {
        id Int @id,
        catId Int
      }
      entity Category {
        id Int @id,
        catId Int,
        label String
      }

      workflow ItemsByCategory {
        {JoinQE/Item? {},
         @join JoinQE/Category {catId? JoinQE/Item.catId},
         @into {itemId JoinQE/Item.id, label JoinQE/Category.label}}
      }
      `
    );
    // Items exist but no matching categories
    await parseAndEvaluateStatement(`{JoinQE/Item {id 1, catId 999}}`);
    const result: any[] = await parseAndEvaluateStatement(`{JoinQE/ItemsByCategory {}}`);
    assert(result instanceof Array);
    assert(result.length == 0);
  });

  test('@join with aggregates returns array', async () => {
    await doInternModule(
      'JoinAgg',
      `entity Sale {
        id Int @id,
        productId Int,
        revenue Decimal
      }
      entity Product {
        id Int @id,
        productId Int,
        category String
      }

      workflow RevenueByCategory {
        {JoinAgg/Sale? {},
         @join JoinAgg/Product {productId? JoinAgg/Sale.productId},
         @into {category JoinAgg/Product.category, total @sum(JoinAgg/Sale.revenue)},
         @groupBy(JoinAgg/Product.category)}
      }
      `
    );
    await parseAndEvaluateStatement(
      `{JoinAgg/Product {id 1, productId 10, category "electronics"}}`
    );
    await parseAndEvaluateStatement(`{JoinAgg/Product {id 2, productId 20, category "books"}}`);
    await parseAndEvaluateStatement(`{JoinAgg/Sale {id 1, productId 10, revenue 100.0}}`);
    await parseAndEvaluateStatement(`{JoinAgg/Sale {id 2, productId 10, revenue 200.0}}`);
    await parseAndEvaluateStatement(`{JoinAgg/Sale {id 3, productId 20, revenue 50.0}}`);

    const result: any[] = await parseAndEvaluateStatement(`{JoinAgg/RevenueByCategory {}}`);
    assert(result instanceof Array);
    assert(result.length == 2);
    const elec = result.find((r: any) => r.category == 'electronics');
    assert(elec && Math.round(Number(elec.total)) == 300);
    const books = result.find((r: any) => r.category == 'books');
    assert(books && Math.round(Number(books.total)) == 50);
  });

  test('multiple @join (nested joins) returns array', async () => {
    await doInternModule(
      'MJoin',
      `entity Fact {
        id Int @id,
        dateId Int,
        prodId Int,
        amount Decimal
      }
      entity DateDim {
        id Int @id,
        dateId Int,
        year Int
      }
      entity ProdDim {
        id Int @id,
        prodId Int,
        name String
      }

      workflow SalesByYearProduct {
        {MJoin/Fact? {},
         @join MJoin/DateDim {dateId? MJoin/Fact.dateId},
         @join MJoin/ProdDim {prodId? MJoin/Fact.prodId},
         @into {year MJoin/DateDim.year, product MJoin/ProdDim.name, total @sum(MJoin/Fact.amount)},
         @groupBy(MJoin/DateDim.year, MJoin/ProdDim.name),
         @orderBy(MJoin/DateDim.year)}
      }
      `
    );
    await parseAndEvaluateStatement(`{MJoin/DateDim {id 1, dateId 1, year 2024}}`);
    await parseAndEvaluateStatement(`{MJoin/DateDim {id 2, dateId 2, year 2025}}`);
    await parseAndEvaluateStatement(`{MJoin/ProdDim {id 1, prodId 10, name "Widget"}}`);
    await parseAndEvaluateStatement(`{MJoin/ProdDim {id 2, prodId 20, name "Gadget"}}`);
    await parseAndEvaluateStatement(`{MJoin/Fact {id 1, dateId 1, prodId 10, amount 100.0}}`);
    await parseAndEvaluateStatement(`{MJoin/Fact {id 2, dateId 1, prodId 20, amount 200.0}}`);
    await parseAndEvaluateStatement(`{MJoin/Fact {id 3, dateId 2, prodId 10, amount 150.0}}`);

    const result: any[] = await parseAndEvaluateStatement(`{MJoin/SalesByYearProduct {}}`);
    assert(result instanceof Array);
    assert(result.length == 3);
    // Verify ordering by year
    assert(result[0].year == 2024);
    const w2024 = result.find((r: any) => r.year == 2024 && r.product == 'Widget');
    assert(w2024 && Math.round(Number(w2024.total)) == 100);
    const g2024 = result.find((r: any) => r.year == 2024 && r.product == 'Gadget');
    assert(g2024 && Math.round(Number(g2024.total)) == 200);
    const w2025 = result.find((r: any) => r.year == 2025 && r.product == 'Widget');
    assert(w2025 && Math.round(Number(w2025.total)) == 150);
  });

  test('@join with @where filter returns array', async () => {
    await doInternModule(
      'JoinW',
      `entity Invoice {
        id Int @id,
        regionId Int,
        total Decimal
      }
      entity Region {
        id Int @id,
        regionId Int,
        country String
      }

      workflow InvoicesByCountry {
        {JoinW/Invoice? {},
         @join JoinW/Region {regionId? JoinW/Invoice.regionId},
         @into {invoiceId JoinW/Invoice.id, country JoinW/Region.country, total JoinW/Invoice.total},
         @where {JoinW/Region.country? InvoicesByCountry.country}}
      }
      `
    );
    await parseAndEvaluateStatement(`{JoinW/Region {id 1, regionId 1, country "US"}}`);
    await parseAndEvaluateStatement(`{JoinW/Region {id 2, regionId 2, country "India"}}`);
    await parseAndEvaluateStatement(`{JoinW/Invoice {id 1, regionId 1, total 500.0}}`);
    await parseAndEvaluateStatement(`{JoinW/Invoice {id 2, regionId 2, total 300.0}}`);
    await parseAndEvaluateStatement(`{JoinW/Invoice {id 3, regionId 1, total 700.0}}`);

    const result: any[] = await parseAndEvaluateStatement(
      `{JoinW/InvoicesByCountry {country "US"}}`
    );
    assert(result instanceof Array);
    assert(result.length == 2);
    assert(result.every((r: any) => r.country == 'US'));

    // Filter for a country with no invoices
    const empty: any[] = await parseAndEvaluateStatement(
      `{JoinW/InvoicesByCountry {country "Japan"}}`
    );
    assert(empty instanceof Array);
    assert(empty.length == 0);
  });
});

describe('Query with @empty and relationships', () => {
  test('@empty on entity query with relationship setup', async () => {
    await doInternModule(
      'EmptyRel',
      `entity Project {
        id Int @id,
        name String
      }
      entity Developer {
        id Int @id,
        name String
      }
      relationship ProjectDev between(Project, Developer) @one_many
      `
    );
    await parseAndEvaluateStatement(`{EmptyRel/Project {id 1, name "alpha"}}`);
    await parseAndEvaluateStatement(`{EmptyRel/Project {id 2, name "beta"}}`);
    // Query project 1 - should find it
    const found: Instance[] = await parseAndEvaluateStatement(`{EmptyRel/Project {id? 1}}`);
    assert(found instanceof Array);
    assert(found.length == 1);
    assert(found[0].lookup('name') == 'alpha');

    // Query non-existent project, @empty falls back to project 2
    const fallback: Instance[] = await parseAndEvaluateStatement(
      `{EmptyRel/Project {id? 999}} @empty {EmptyRel/Project {id? 2}} @as [P]`
    );
    assert(fallback instanceof Array);
    assert(fallback.length == 1);
    assert(fallback[0].lookup('name') == 'beta');
  });

  test('@empty on contains relationship query', async () => {
    await doInternModule(
      'EmptyCont',
      `entity Shelf {
        id Int @id,
        label String
      }
      entity Item {
        id Int @id,
        name String
      }
      relationship ShelfItem contains(Shelf, Item)
      `
    );
    await parseAndEvaluateStatement(`{EmptyCont/Shelf {id 1, label "A"}}`);
    await parseAndEvaluateStatement(`{EmptyCont/Shelf {id 2, label "B"}}`);
    await parseAndEvaluateStatement(
      `{EmptyCont/Shelf {id? 1},
       EmptyCont/ShelfItem {EmptyCont/Item {id 10, name "widget"}}}`
    );
    // Query non-existent shelf, fall back to shelf 1
    const result: Instance[] = await parseAndEvaluateStatement(
      `{EmptyCont/Shelf {id? 999}} @empty {EmptyCont/Shelf {id? 1}} @as [S]`
    );
    assert(result instanceof Array);
    assert(result.length == 1);
    assert(result[0].lookup('label') == 'A');
  });
});

describe('Query-all with relationships returns array', () => {
  test('query-all with between relationship and @into', async () => {
    await doInternModule(
      'QAllRel',
      `entity Student {
        id Int @id,
        name String
      }
      entity Course {
        id Int @id,
        title String
      }
      relationship Enrollment between(Student, Course) @one_many

      workflow Enroll {
        {QAllRel/Student {id? Enroll.studentId}} @as [S]
        {QAllRel/Course {id? Enroll.courseId}} @as [C]
        {QAllRel/Enrollment {Student S, Course C}}
      }

      workflow AllEnrollments {
        {QAllRel/Student? {},
         QAllRel/Enrollment {QAllRel/Course? {}},
         @into {student QAllRel/Student.name, course QAllRel/Course.title}}
      }
      `
    );
    await parseAndEvaluateStatement(`{QAllRel/Student {id 1, name "Alice"}}`);
    await parseAndEvaluateStatement(`{QAllRel/Student {id 2, name "Bob"}}`);
    await parseAndEvaluateStatement(`{QAllRel/Course {id 10, title "Math"}}`);
    await parseAndEvaluateStatement(`{QAllRel/Course {id 20, title "Physics"}}`);
    // Enroll via workflow
    await parseAndEvaluateStatement(`{QAllRel/Enroll {studentId 1, courseId 10}}`);
    await parseAndEvaluateStatement(`{QAllRel/Enroll {studentId 2, courseId 20}}`);

    const result: any[] = await parseAndEvaluateStatement(`{QAllRel/AllEnrollments {}}`);
    assert(result instanceof Array);
    assert(result.length == 2);
    const alice = result.find((r: any) => r.student == 'Alice');
    assert(alice && alice.course == 'Math');
    const bob = result.find((r: any) => r.student == 'Bob');
    assert(bob && bob.course == 'Physics');
  });

  test('query-all with no data returns empty array', async () => {
    await doInternModule(
      'QAllE',
      `entity X {
        id Int @id,
        v Int
      }
      entity Y {
        id Int @id,
        w Int
      }
      relationship XY between(X, Y) @one_many

      workflow AllXY {
        {QAllE/X? {},
         QAllE/XY {QAllE/Y? {}},
         @into {xv QAllE/X.v, yw QAllE/Y.w}}
      }
      `
    );
    // No data at all
    const result: any[] = await parseAndEvaluateStatement(`{QAllE/AllXY {}}`);
    assert(result instanceof Array);
    assert(result.length == 0);
  });
});

describe('Expression attributes', () => {
  test('test01', async () => {
    await doInternModule(
      'ExprAttr',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10),
        z Int @expr(y + 1)
      }
      entity F {
        id Int @id,
        e Path,
        a Int @expr(e.y + 10 - k),
        k Int
      }
      `
    );
    const ise = (r: any) => isInstanceOfType(r, 'ExprAttr/E');
    const cre = async (id: number, x: number): Promise<Instance> => {
      const r: any = await parseAndEvaluateStatement(`{ExprAttr/E {id ${id}, x ${x}}}`);
      assert(ise(r));
      return r as Instance;
    };
    const e1 = await cre(1, 10);
    await cre(2, 20);
    await parseAndEvaluateStatement(`{ExprAttr/E {id? 1}}`).then((result: Instance[]) => {
      assert(result.length == 1);
      assert(result.every(ise));
      const r: Instance = result[0];
      assert(
        r.lookup('id') == 1 && r.lookup('x') == 10 && r.lookup('y') == 100 && r.lookup('z') == 101
      );
    });
    await parseAndEvaluateStatement(`{ExprAttr/E? {}}`).then((result: Instance[]) => {
      assert(result.length == 2);
      assert(result.every(ise));
      let ys = 0;
      let zs = 0;
      result.forEach((r: Instance) => {
        ys += r.lookup('y');
        zs += r.lookup('z');
      });
      assert(ys == 300);
      assert(zs == 302);
    });
    const crf = async (id: number, e: string, k: number): Promise<Instance> => {
      const f = await parseAndEvaluateStatement(`{ExprAttr/F {id ${id}, e "${e}", k ${k}}}`);
      assert(isInstanceOfType(f, 'ExprAttr/F'));
      return f as Instance;
    };
    const f = await crf(11, e1.lookup(PathAttributeName), 5);
    assert(f.lookup('a') == 105);
  });
});

describe('Composite unique attributes', () => {
  test('test01', async () => {
    await doInternModule(
      'Cuq',
      `entity E {
        id Int @id,
        x Int,
        y Int,
        @with_unique(x, y)
      }`
    );
    const ee = expectError();
    const cre = async (id: number, x: number, y: number, err: boolean = false) => {
      const r: any = await parseAndEvaluateStatement(`{Cuq/E {id ${id}, x ${x}, y ${y}}}`).catch(
        (reason: any) => {
          if (err) {
            ee.f()(reason);
          } else {
            throw new Error(reason);
          }
        }
      );
      if (!err) {
        assert(isInstanceOfType(r, 'Cuq/E'));
        assert(r.lookup('id') == id && r.lookup('x') == x && r.lookup('y') == y);
      }
    };
    await cre(1, 10, 20);
    await cre(2, 10, 30);
    await cre(3, 10, 20, true);
    await cre(4, 20, 10);
  });
});

describe('Between operator test', () => {
  test('test01', async () => {
    await doInternModule(
      'BetOpr',
      `entity E {
        id Int @id,
        x Int,
        y DateTime
      }`
    );
    const ise = (r: any) => isInstanceOfType(r, 'BetOpr/E');
    const cre = async (id: number, x: number, y: string) => {
      const r = await parseAndEvaluateStatement(`{BetOpr/E {id ${id}, x ${x}, y "${y}"}}`);
      assert(ise(r));
      return r;
    };
    await cre(1, 10, '2025-01-02');
    await cre(2, 20, '2025-02-20');
    await cre(3, 30, '2025-03-01');
    await cre(4, 40, '2025-03-12');
    let result: Instance[] = await parseAndEvaluateStatement(`{BetOpr/E {x?between [20, 40]}}`);
    assert(result.length == 3);
    assert(
      result.every((inst: Instance) => {
        return inst.lookup('x') > 10;
      })
    );
    result = await parseAndEvaluateStatement(`{BetOpr/E {y?between ["2025-01-01", "2025-03-05"]}}`);
    assert(result.length == 3);
    assert(
      result.every((inst: Instance) => {
        return inst.lookup('x') < 40;
      })
    );
  });
});

describe('Test string append', () => {
  test('test01', async () => {
    await doInternModule(
      'TestExpr',
      `workflow T {
        T.a + ", " + T.b @as result;
        result
      }`
    );
    const r = await parseAndEvaluateStatement(`{TestExpr/T {a "hello", b "world"}}`);
    assert(r == 'hello, world');
  });
});

describe('Return from Workflow', () => {
  test('test01', async () => {
    await doInternModule(
      'Ret',
      `record X {x Int}
       record Y {y Int}
       entity Z {z Int}
       workflow T {
        if (T.v == 1) {
          return {X {x 10}}
        } else {
          {Z {z T.z}}
        }
        {Y {y 200}}
      }`
    );
    const t = async (v: number, z: number) => {
      return await parseAndEvaluateStatement(`{Ret/T {v ${v}, z ${z}}}`);
    };
    const r1 = await t(1, 0);
    assert(isInstanceOfType(r1, 'Ret/X'));
    const r2 = await t(0, 1);
    assert(isInstanceOfType(r2, 'Ret/Y'));
    const zs = await parseAndEvaluateStatement(`{Ret/Z? {}}`);
    assert(zs.length == 1);
    assert(isInstanceOfType(zs[0], 'Ret/Z'));
  });
});

describe('Not-equals', () => {
  test('test01', async () => {
    await doInternModule(
      'neq',
      `workflow test {
        if (test.x != 100) {
          return 200
        } else {
          return test.x
        }
      }`
    );
    const t = async (x: number) => {
      return await parseAndEvaluateStatement(`{neq/test {x ${x}}}`);
    };

    const a = await t(100);
    assert(a == 100);
    const b = await t(300);
    assert(b == 200);
  });
});

describe('Config entity', () => {
  test('test01', async () => {
    await doInternModule(
      'cfge',
      `entity A {
        id Int @id, x Int
      }
      entity B {
        key Int @comment("Secret key"),
        host String @comment("Host name"),
        @meta {"configEntity": true}
      }
      entity C {
        id Int @id, y Int
      }
      `
    );
    const m = fetchModule('cfge');
    const e = m.getConfigEntity();
    if (e) {
      assert(e.getFqName() == 'cfge/B');
      e.getUserAttributes().forEach((attr: AttributeSpec, n: string) => {
        const c = attr.properties?.get('comment');
        if (n == 'key') {
          assert(c == 'Secret key');
        } else if (n == 'host') {
          assert(c == 'Host name');
        }
      });
    } else {
      assert(e !== undefined);
    }
    const s = m.toString();
    assert(
      s ==
        `module cfge

entity A
{
    id Int @id,
    x Int
}

entity B
{
    key Int @comment("Secret key"),
    host String @comment("Host name"),
    @meta {"configEntity":true}
}

entity C
{
    id Int @id,
    y Int
}
`
    );
    const idx = s.indexOf('entity');
    await doInternModule('cfge2', s.substring(idx));
    assert(fetchModule('cfge2'));
  });
});

describe('Fetch rels for entity', () => {
  test('test01', async () => {
    await doInternModule(
      'FRels',
      `entity A {
        id Int @id, x Int
      }
      entity B {
        id Int @id, y Int
      }
      entity C {
        id Int @id, z Int
      }
      relationship AB between(A, B)
      relationship AC between(A, C)
      relationship BC contains(B, C)
    `
    );
    let rels = getAllBetweenRelationshipsForEntity('FRels', 'A');
    const chk = (rels: Relationship[], names: string[]) => {
      assert(rels.length == names.length);
      const s1 = new Set(
        rels.map((r: Relationship) => {
          return r.getFqName();
        })
      );
      names.forEach((n: string) => {
        assert(s1.has(n));
      });
    };
    chk(rels, ['FRels/AB', 'FRels/AC']);
    rels = getAllBetweenRelationshipsForEntity('FRels', 'C');
    chk(rels, ['FRels/AC']);
    rels = getAllBetweenRelationshipsForEntity('FRels', 'B');
    chk(rels, ['FRels/AB']);
  });
});

describe('Destructuring', () => {
  test('test01', async () => {
    await doInternModule(
      'Des',
      `entity Employee {
        id Int @id,
        name String,
        salary Int
      }
      workflow Test1 {
        {Des/Employee {salary?> 5000}} @as employees;
        employees
      }
      workflow Test2 {
        {Des/Employee {salary?> 5000}} @as [e1];
        e1
      }
      workflow Test3 {
        {Des/Employee {salary?> 5000}} @as [e1, _, e2, __, es];
        [e1, e2, es]
      }
      `
    );
    const isemp = (obj: any) => {
      return isInstanceOfType(obj, 'Des/Employee');
    };
    const cre = async (id: number, name: string, salary: number) => {
      const e = await parseAndEvaluateStatement(
        `{Des/Employee {id ${id}, name "${name}", salary ${salary}}}`
      );
      assert(isemp(e));
    };
    await cre(1, 'a', 2000);
    await cre(2, 'b', 5001);
    await cre(3, 'c', 5600);
    await cre(4, 'd', 2600);
    await cre(5, 'e', 6800);
    await cre(6, 'f', 9000);
    const r1: Instance[] = await parseAndEvaluateStatement(`{Des/Test1 {}}`);
    assert(r1.length == 4);
    assert(
      r1.every((inst: Instance) => {
        return isemp(inst);
      })
    );
    const r2 = await parseAndEvaluateStatement(`{Des/Test2 {}}`);
    assert(isemp(r2));
    const r3: any[] = await parseAndEvaluateStatement(`{Des/Test3 {}}`);
    assert(isemp(r3[0]) && isemp(r3[1]));
    assert(isemp(r3[2][0]));
  });
});

describe('Flow API', () => {
  test('test01', async () => {
    await doInternModule(
      'flowApi',
      `entity E {
        id Int @id
      }

      flow orchestrator {
        incidentTriager --> "DNS" findManagerForCategory
        incidentTriager --> "WLAN" findManagerForCategory
        incidentTriager --> "Other" incidentStatusUpdater
        findManagerForCategory --> managerRequestHandler
        managerRequestHandler --> "approve" incidentProvisioner
        managerRequestHandler --> "reject" incidentStatusUpdater
        incidentProvisioner --> incidentStatusUpdater
    }

    flow analyser {
      analyseEmail --> "OK" sendConfirmation
      analyseEmail --> "SPAM" deleteEmail
    }`
    );
    const mod = fetchModule('flowApi');
    let flows = mod.getAllFlows();
    assert(flows.length == 2);
    mod.removeFlow('orchestrator');
    flows = mod.getAllFlows();
    assert(flows.length == 1);
    const s0 = new FlowStepPattern('analyseEmail').setCondition('ARC');
    await s0.setNextFromString('archiveEmail');
    flows[0].appendStep(s0.toString());
    const s = mod.toString();
    assert(
      s ==
        `module flowApi

entity E
{
    id Int @id
}

flow analyser {
      analyseEmail --> "OK" sendConfirmation
analyseEmail --> "SPAM" deleteEmail
analyseEmail --> "ARC" archiveEmail
    }`
    );
  });
});

describe('Instances as JS objects', () => {
  test('JS obejct syntax for instances', async () => {
    await doInternModule(
      'JsObj',
      `entity E {
        id Int @id,
        x String
      }
      
      workflow W1 {
        {E: {x?: W1.x}}
      }

      workflow W2 {
        {E: {id?>: W2.id}}
      }
      `
    );
    const cre = async (id: number, x: string) => {
      const e = await parseAndEvaluateStatement(`{JsObj/E: {id: ${id}, x: "${x}"}}`);
      assert(isInstanceOfType(e, 'JsObj/E'));
      return e;
    };
    await cre(1, 'a');
    await cre(2, 'b');
    await cre(3, 'c');
    let rs: Instance[] = await parseAndEvaluateStatement(`{JsObj/W1: {x: "b"}}`);
    assert(rs.length == 1);
    assert(rs[0].lookup('id') == 2);
    rs = await parseAndEvaluateStatement(`{JsObj/W2: {id: 1}}`);
    assert(rs.length == 2);
    rs.forEach((inst: Instance) => {
      const id = inst.lookup('id');
      assert(id == 2 || id == 3);
    });
  });
});

describe('tracking-attrs', () => {
  test('set tracking attributes in entity instances', async () => {
    await doInternModule(
      'TA',
      `entity E {
        id Int @id,
        x String
      }

      workflow Up {
        {E {id? Up.id, x Up.x}} @as [e];
        e
      }

      workflow Ups {
        {E {id Ups.id, x Ups.x}, @upsert}
      }`
    );
    const ise = (x: any) => {
      assert(isInstanceOfType(x, 'TA/E'));
    };
    const e1: Instance = await parseAndEvaluateStatement(`{TA/E {id 1, x "hello"}}`, 'user01');
    ise(e1);
    const e1m = e1.metaAttributeValues();
    assert(e1m.created);
    assert(e1m.createdBy === 'user01');
    assert(e1m.lastModifiedBy === 'user01');
    const lm1 = e1m.lastModified;
    assert(lm1);
    const e2: Instance = await parseAndEvaluateStatement(`{TA/Up {id 1, x "ok"}}`, 'user02');
    ise(e2);
    const e2m = e2.metaAttributeValues();
    const lm2 = e2m.lastModified;
    assert(e2m.createdBy === e1m.createdBy);
    assert(e2m.lastModifiedBy === 'user02');
    assert(lm2);
    assert(lm2 > lm1);
    assert(e1m.created === e2m.created);
    assert(e2.lookup('x') === 'ok');
    let es: Instance[] = await parseAndEvaluateStatement(`{TA/E? {}}`);
    assert(es.length == 1);
    const es1 = es[0];
    const es1m = es1.metaAttributeValues();
    assert(es1m.created === e1m.created);
    assert(es1m.lastModified > e1m.lastModified);
    assert(es1m.lastModifiedBy === 'user02');
    assert(es1m.createdBy === 'user01');
    const e3: Instance = await parseAndEvaluateStatement(`{TA/Ups {id 1, x "bye"}}`, 'user03');
    ise(e3);
    const e3m = e3.metaAttributeValues();
    const lm3 = e3m.lastModified;
    assert(lm3);
    assert(lm3 > lm2);
    assert(e3m.created);
    assert(e3m.createdBy === 'user03');
    assert(e3m.lastModifiedBy === 'user03');
    es = await parseAndEvaluateStatement(`{TA/E? {}}`);
    assert(es.length === 1);
    const e4 = es[0];
    const e4m = e4.metaAttributeValues();
    assert(e4m.created === e3m.created);
    assert(e4m.lastModified === e3m.lastModified);
    assert(e4m.lastModifiedBy === 'user03');
    assert(e4m.createdBy === 'user03');
    assert(e4.lookup('x') === 'bye');
    assert(e4.lookup('id') === 1);
  });
});

describe('raiseError', () => {
  test('throw errors from workflows', async () => {
    await doInternModule(
      'RE',
      `workflow W {
        if (W.x < 0) {
          throw("neg: " + W.x)
        } else {
          W.x + 2  
        }
       }
        workflow X {
          {W {x X.x}}
          @catch {error {W {x 0}}}
        }`
    );

    const r1 = await parseAndEvaluateStatement(`{RE/W {x 100}}`);
    assert(r1 == 102);
    let err: any = undefined;
    try {
      await parseAndEvaluateStatement(`{RE/W {x -2}}`);
    } catch (reason: any) {
      err = reason;
    }
    assert(err?.message == 'neg: -2');
    const r2 = await parseAndEvaluateStatement(`{RE/X {x 1}}`);
    assert(r2 == 3);
    const r3 = await parseAndEvaluateStatement(`{RE/X {x -3}}`);
    assert(r3 == 2);
  });
});

describe('custom-defaults', () => {
  test('custom default function', async () => {
    await doInternModule(
      'Cdf',
      `entity E {
        id Int @id @default(agentlang.inc()),
        x String
      }`
    );
    let c = 0;
    const inc = () => {
      return ++c;
    };
    agentlang.inc = inc;
    const fqn = 'Cdf/E';
    const chk = (inst: Instance, x: string) => {
      assert(isInstanceOfType(inst, fqn));
      assert(inst.lookup('id') === c);
      assert(inst.lookup('x') === x);
    };
    chk(makeInstance('Cdf', 'E', newInstanceAttributes().set('x', 'abc')), 'abc');
    chk(await parseAndEvaluateStatement(`{${fqn} {x "xyz"}}`), 'xyz');
    const s = fetchModule('Cdf').toString();
    assert(
      s ===
        `module Cdf

entity E
{
    id Int @id  @default(agentlang.inc()),
    x String
}
`
    );
  });
});

describe('write-only-attributes', () => {
  test('queries must not return writeonly attributes', async () => {
    const moduleName = 'rda';
    await doInternModule(
      moduleName,
      `entity E {
        id Int @id,
        x String,
        y String @writeonly(true),
        z String @secret(true),
        p1 Password,
        p2 Password @writeonly(true),
        a Int
      }`
    );
    const ename = `${moduleName}/E`;
    const cre = async (
      id: number,
      x: string,
      y: string,
      z: string,
      a: number
    ): Promise<Instance> => {
      const inst: Instance = await parseAndEvaluateStatement(`{${ename} {
        id ${id}, x "${x}", y "${y}", z "${z}", p1 "${x}-${y}", p2 "${x}-${z}", a ${a}}}`);
      assert(isInstanceOfType(inst, ename));
      return inst;
    };
    await cre(1, 'a', 'b', 'c', 10);
    await cre(2, 'p', 'q', 'r', 20);
    const r1: Instance[] = await parseAndEvaluateStatement(`{${ename}? {}}`);
    assert(r1.length === 2);
    assert(
      r1.every((inst: Instance) => {
        return (
          isInstanceOfType(inst, ename) &&
          inst.lookup('id') > 0 &&
          inst.lookup('a') >= 10 &&
          inst.lookup('x').length >= 1 &&
          inst.lookup('y') === undefined &&
          inst.lookup('z') === undefined &&
          inst.lookup('p1').length >= 5 &&
          inst.lookup('p2') === undefined
        );
      })
    );
  });
});
