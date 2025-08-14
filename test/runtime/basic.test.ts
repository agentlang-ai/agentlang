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
import { DefaultIdAttributeName, PathAttributeName } from '../../src/runtime/defs.js';

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
  test('test01', async () => {
    await doPreInit();
    await load('example/blog/src/blog.al').then((appSpec: ApplicationSpec) => {
      assert(appSpec.name, 'Invalid application spec');
      const m: Module = fetchModule('Blog.Core');
      try {
        assert(m.name == 'Blog.Core', 'Failed to load Blog module');
        let re: Record = m.getEntry('UserPost') as Record;
        assert(re != undefined, 'UserPost entry not found');
        const attrs: Set<string> = new Set(['User', 'Post']);
        re.schema.keys().forEach((k: string) => {
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
        assert(edge != undefined, 'Edge for UserProfile not found');
        if (edge != undefined) {
          assert(edge.node.entity.getEntryName() == 'Profile', 'Profile not found in relationship');
          assert(edge.node.edges.length == 0, 'Profile does not have relationships');
        }
        edge = findEdgeForRelationship('UserPost', 'Blog.Core', node.edges);
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
      workflow BeforeDelete {
        delete {F {id? BeforeDelete.E.id}}
      }
     `
    );
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

describe('Default id attribute test', () => {
  test('test01', async () => {
    await doInternModule(
      'DefId',
      `entity E {
        x Int
      }`
    );
    const m = fetchModule('DefId');
    const e = m.getEntry('E');
    assert((e as Record).getIdAttributeName() == DefaultIdAttributeName);
    await parseAndEvaluateStatement(`{DefId/E {x 10}}`).then((result: Instance) => {
      assert(isInstanceOfType(result, 'DefId/E'));
      const id: string = result.lookup(DefaultIdAttributeName);
      assert(id.length > 0);
      const path: string = result.lookup(PathAttributeName);
      assert(path.indexOf(id) > 0);
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
        await flushAllAndLoad('example/family/family.al').then(
          async (erpAppSpec: ApplicationSpec) => {
            assert(erpAppSpec.name, 'Invalid Family application spec');
            const familyModule: Module = fetchModule('Family');
            assert(familyModule.name == 'Family', 'Failed to load Family module');
            assert(familyModule.hasEntry('Member'), 'Family module missing Member entity');

            // Critical test: Blog module should not still be accessible after Family load
            assert(!isModule('Blog.Core'), 'Blog.Core module not removed before ErpCore load');
            assert(isModule('Family'), 'Family module not registered');

            removeModule('Family');
            assert(!isModule('Family'), 'Family module not removed');
          }
        );
      });
    } finally {
      try {
        removeModule('Blog.Core');
      } catch { }
      try {
        removeModule('Family');
      } catch { }
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

describe("Test string append", () => {
  test('test01', async () => {
    await doInternModule(
      'TestExpr',
      `workflow T {
        T.a + ", " + T.b @as result;
        result
      }`)
    const r = await parseAndEvaluateStatement(`{TestExpr/T {a "hello", b "world"}}`)
    assert(r == "hello, world")
  })
})


describe("Return from Workflow", () => {
  test('test01', async () => {
    await doInternModule(
      'Ret',
      `record X {x Int}
       record Y {y Int}
       entity Z {z Int}
       workflow T {
        if (T.v = 1) {
          return {X {x 10}}
        } else {
          {Z {z T.z}}
        }
        {Y {y 200}}
      }`)
    const t = async (v: number, z: number) => {
      return await parseAndEvaluateStatement(`{Ret/T {v ${v}, z ${z}}}`)
    }
    const r1 = await t(1, 0)
    assert(isInstanceOfType(r1, 'Ret/X'))
    const r2 = await t(0, 1)
    assert(isInstanceOfType(r2, 'Ret/Y'))
    const zs = await parseAndEvaluateStatement(`{Ret/Z? {}}`)
    assert(zs.length == 1)
    assert(isInstanceOfType(zs[0], 'Ret/Z'))
  })
})

describe("Not-equals", () => {
  test('test01', async () => {
    await doInternModule('neq',
      `workflow test {
        if (test.x != 100) {
          return 200
        } else {
          return test.x
        }
      }`)
    const t = async (x: number) => {
      return await parseAndEvaluateStatement(`{neq/test {x ${x}}}`)
    }

    const a = await t(100)
    assert(a == 100)
    const b = await t(300)
    assert(b == 200)
  })
})

describe("Config entity", () => {
  test('test01', async () => {
    await doInternModule('cfge',
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
      `)
    const m = fetchModule('cfge')
    const e = m.getConfigEntity()
    if (e) {
      assert(e.getFqName() == 'cfge/B')
      e.getUserAttributes().forEach((attr: AttributeSpec, n: string) => {
        const c = attr.properties?.get('comment')
        if (n == 'key') {
          assert(c == 'Secret key')
        } else if (n == 'host') {
          assert(c == 'Host name')
        }
      })
    } else {
      assert(e != undefined)
    }
    const s = m.toString()
    assert(s == `module cfge

entity A
{
    id Int @id,
    x Int
}

entity B
{
    key Int @comment("Secret key"),
    host String @comment("Host name"),
    __id__ UUID @default(uuid())  @id,
    @meta {"configEntity":true}
}

entity C
{
    id Int @id,
    y Int
}
`)
    const idx = s.indexOf('entity')
    await doInternModule('cfge2', s.substring(idx))
    assert(fetchModule('cfge2'))
  })
})

describe("Fetch rels for entity", () => {
  test('test01', async () => {
    await doInternModule('FRels',
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
    `)
    let rels = getAllBetweenRelationshipsForEntity('FRels', 'A')
    const chk = (rels: Relationship[], names: string[]) => {
      assert(rels.length == names.length)
      const s1 = new Set(rels.map((r: Relationship) => {
        return r.getFqName()
      }))
      names.forEach((n: string) => {
        assert(s1.has(n))
      })
    }
    chk(rels, ["FRels/AB", "FRels/AC"])
    rels = getAllBetweenRelationshipsForEntity('FRels', 'C')
    chk(rels, ['FRels/AC'])
    rels = getAllBetweenRelationshipsForEntity('FRels', 'B')
    chk(rels, ['FRels/AB'])
  })
})