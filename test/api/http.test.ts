import { assert, describe, test, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/api/http.js';
import { doInternModule } from '../util.js';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

let server: Server;
let baseUrl: string;

async function post(path: string, body: object): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function get(path: string, query?: Record<string, string>): Promise<Response> {
  let url = `${baseUrl}${path}`;
  if (query) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }
  return fetch(url);
}

async function put(path: string, body: object): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function del(path: string, body?: object): Promise<Response> {
  const opts: RequestInit = { method: 'DELETE' };
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${path}`, opts);
}

beforeAll(async () => {
  await doInternModule(
    'HRT',
    `entity User {
      id Int @id,
      name String,
      email Email
    }

    entity Post {
      id Int @id,
      title String
    }

    entity Comment {
      id Int @id,
      text String
    }

    relationship UserPost between(User, Post) @one_many
    relationship PostComment contains(Post, Comment)

    @public event CreateUser {
      id Int,
      name String
    }

    workflow CreateUser {
      CreateUser.name + "@test.com" @as email;
      {User {id CreateUser.id, name CreateUser.name, email email}}
    }`
  );
  const app = await createApp({ name: 'test-app', version: '0.0.1' });
  server = app.listen(0);
  const addr = server.address() as AddressInfo;
  baseUrl = `http://localhost:${addr.port}`;
});

afterAll(() => {
  server?.close();
});

// ──────────────────────────────────────────────────────────────────
// Entity CRUD
// ──────────────────────────────────────────────────────────────────

describe('Entity Create - POST', () => {
  test('POST /Module/Entity creates an entity and returns it', async () => {
    const res = await post('/HRT/User', { id: 1, name: 'Alice', email: 'alice@test.com' });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.User, 'Response should contain User key');
    assert(body.User.id === 1);
    assert(body.User.name === 'Alice');
    assert(body.User.email === 'alice@test.com');
    assert(body.User.__path__, 'Response should include __path__');
  });

  test('POST /Module/Entity creates a second entity', async () => {
    const res = await post('/HRT/User', { id: 2, name: 'Bob', email: 'bob@test.com' });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.User.id === 2);
    assert(body.User.name === 'Bob');
  });

  test('POST with duplicate @id should fail', async () => {
    const res = await post('/HRT/User', { id: 1, name: 'Duplicate', email: 'dup@test.com' });
    assert(!res.ok, 'Duplicate id should fail');
  });

  test('POST /Module/Post creates a Post entity', async () => {
    const res = await post('/HRT/Post', { id: 100, title: 'First Post' });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.Post.id === 100);
    assert(body.Post.title === 'First Post');
  });

  test('POST /Module/Post creates a second Post', async () => {
    const res = await post('/HRT/Post', { id: 101, title: 'Second Post' });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.Post.id === 101);
  });
});

describe('Entity Query - GET', () => {
  test('GET /Module/Entity returns all entities', async () => {
    const res = await get('/HRT/User');
    assert(res.ok, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(Array.isArray(body), 'Response should be an array');
    assert(body.length === 2, `Expected 2 users, got ${body.length}`);
    const names = body.map((u: any) => u.User.name).sort();
    assert(names[0] === 'Alice');
    assert(names[1] === 'Bob');
  });

  test('GET /Module/Entity with query params filters results', async () => {
    const res = await get('/HRT/User', { name: 'Alice' });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(Array.isArray(body), 'Response should be an array');
    assert(body.length === 1, `Expected 1 user, got ${body.length}`);
    assert(body[0].User.name === 'Alice');
  });

  test('GET /Module/Entity/id returns a single entity', async () => {
    // URL uses just the ID — pathFromRequest prepends the escaped FQ name (HRT$User/)
    const res = await get('/HRT/User/1');
    assert(res.ok, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(Array.isArray(body), 'Single-path query returns an array');
    assert(body.length === 1);
    assert(body[0].User.id === 1);
    assert(body[0].User.name === 'Alice');
  });
});

describe('Entity Update - PUT', () => {
  test('PUT /Module/Entity/id updates entity attributes', async () => {
    const res = await put('/HRT/User/2', { name: 'Bobby' });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(Array.isArray(body), 'Update response is an array');
    assert(body.length === 1);
    assert(body[0].User.name === 'Bobby', 'Name should be updated');
    assert(body[0].User.id === 2, 'Id should remain unchanged');
  });

  test('updated value persists on subsequent query', async () => {
    const res = await get('/HRT/User', { id: '2' });
    const body = await res.json();
    assert(body[0].User.name === 'Bobby');
  });
});

describe('Entity Delete - DELETE', () => {
  test('DELETE /Module/Entity/id removes the entity', async () => {
    // Create a user to delete
    await post('/HRT/User', { id: 99, name: 'ToDelete', email: 'del@test.com' });

    // Verify it exists
    let qRes = await get('/HRT/User', { id: '99' });
    let qBody = await qRes.json();
    assert(qBody.length === 1, 'User should exist before delete');

    // Delete by id
    const res = await del('/HRT/User/99');
    assert(res.ok, `Expected 200, got ${res.status}`);

    // Verify it's gone
    qRes = await get('/HRT/User', { id: '99' });
    qBody = await qRes.json();
    assert(qBody.length === 0, 'User should not exist after delete');
  });
});

// ──────────────────────────────────────────────────────────────────
// Between Relationship CRUD
// ──────────────────────────────────────────────────────────────────

describe('Between Relationship - Link (POST)', () => {
  test('POST /Module/RelName links two entities', async () => {
    // Link User 1 (Alice) to Post 100
    const res = await post('/HRT/UserPost', { User: 1, Post: 100 });
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  test('POST /Module/RelName links another pair', async () => {
    // Link User 1 (Alice) to Post 101
    const res = await post('/HRT/UserPost', { User: 1, Post: 101 });
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  test('POST /Module/RelName links User 2 to Post 100', async () => {
    const res = await post('/HRT/UserPost', { User: 2, Post: 100 });
    assert(res.ok, `Expected 200, got ${res.status}`);
  });
});

describe('Between Relationship - Query (GET)', () => {
  test('GET /Module/RelName returns all relationship entries', async () => {
    const res = await get('/HRT/UserPost');
    assert(res.ok, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(Array.isArray(body), 'Response should be an array');
    assert(body.length === 3, `Expected 3 relationship entries, got ${body.length}`);
  });
});

describe('Between Relationship - Unlink (DELETE)', () => {
  test('DELETE /Module/RelName unlinks two entities', async () => {
    // Unlink User 2 from Post 100
    const res = await del('/HRT/UserPost', { User: 2, Post: 100 });
    assert(res.ok, `Expected 200, got ${res.status}`);

    // Verify only 2 links remain
    const qRes = await get('/HRT/UserPost');
    const body = await qRes.json();
    assert(body.length === 2, `Expected 2 relationship entries after unlink, got ${body.length}`);
  });
});

// ──────────────────────────────────────────────────────────────────
// Contains Relationship (Parent-Child)
// ──────────────────────────────────────────────────────────────────

describe('Contains Relationship - Create Child', () => {
  test('POST child entity via parent path creates and links it', async () => {
    // Create a Comment as a child of Post 100 via the contains relationship
    // URL format: /Module/ParentEntity/parentId/RelationshipName/ChildEntity
    const res = await post('/HRT/Post/100/PostComment/Comment', {
      id: 500,
      text: 'Great post!',
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  test('POST creates a second child comment', async () => {
    const res = await post('/HRT/Post/100/PostComment/Comment', {
      id: 501,
      text: 'Nice work!',
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  test('GET with tree=true returns parent with nested children', async () => {
    const res = await get('/HRT/Post/100', { tree: 'true' });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(Array.isArray(body), 'Tree response should be an array');
    assert(body.length === 1, 'Should return one post');
    const post = body[0].Post;
    assert(post.id === 100);
    const comments = post['HRT/PostComment'];
    assert(Array.isArray(comments), 'Post should have PostComment children');
    assert(comments.length === 2, `Expected 2 comments, got ${comments.length}`);
  });
});

// ──────────────────────────────────────────────────────────────────
// Event Invocation
// ──────────────────────────────────────────────────────────────────

describe('Event Invocation - POST', () => {
  test('POST /Module/Event triggers the workflow and creates entity', async () => {
    const res = await post('/HRT/CreateUser', { id: 50, name: 'EventUser' });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const body = await res.json();
    // The workflow returns the created User
    assert(body.User, 'Response should contain the created User');
    assert(body.User.id === 50);
    assert(body.User.name === 'EventUser');
    assert(body.User.email === 'EventUser@test.com', 'Email should be computed by workflow');
  });

  test('entity created via event is queryable', async () => {
    const res = await get('/HRT/User', { id: '50' });
    assert(res.ok);
    const body = await res.json();
    assert(body.length === 1);
    assert(body[0].User.name === 'EventUser');
    assert(body[0].User.email === 'EventUser@test.com');
  });
});

// ──────────────────────────────────────────────────────────────────
// Entity Create with Inline Relationships
// ──────────────────────────────────────────────────────────────────

describe('Entity Create with Inline Relationships', () => {
  test('POST with a single inline relationship child object', async () => {
    const res = await post('/HRT/User', {
      id: 200,
      name: 'InlineUser1',
      email: 'inline1@test.com',
      UserPost: { id: 300, title: 'Inline Post' },
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.User, 'Response should contain User');
    assert(body.User.id === 200);
    assert(body.User.name === 'InlineUser1');
  });

  test('inline relationship child entity is queryable', async () => {
    const res = await get('/HRT/Post', { id: '300' });
    assert(res.ok);
    const body = await res.json();
    assert(body.length === 1, `Expected 1 post, got ${body.length}`);
    assert(body[0].Post.title === 'Inline Post');
  });

  test('inline relationship link is queryable', async () => {
    const res = await get('/HRT/UserPost');
    assert(res.ok);
    const body = await res.json();
    // Previous tests leave 2 links; inline single-child POST should add 1 more
    assert(
      body.length === 3,
      `Expected 3 UserPost links, got ${body.length}: ${JSON.stringify(body)}`
    );
  });

  test('POST with an array of inline relationship children', async () => {
    const res = await post('/HRT/User', {
      id: 201,
      name: 'InlineUser2',
      email: 'inline2@test.com',
      UserPost: [
        { id: 301, title: 'Array Post 1' },
        { id: 302, title: 'Array Post 2' },
      ],
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.User, 'Response should contain User');
    assert(body.User.id === 201);
  });

  test('array inline relationship children are queryable', async () => {
    const res1 = await get('/HRT/Post', { id: '301' });
    assert(res1.ok);
    const body1 = await res1.json();
    assert(body1.length === 1);
    assert(body1[0].Post.title === 'Array Post 1');

    const res2 = await get('/HRT/Post', { id: '302' });
    assert(res2.ok);
    const body2 = await res2.json();
    assert(body2.length === 1);
    assert(body2[0].Post.title === 'Array Post 2');
  });

  test('array inline relationship links are queryable', async () => {
    const res = await get('/HRT/UserPost');
    assert(res.ok);
    const body = await res.json();
    // Previous tests leave 2 links, single inline added 1, array inline should add 2 more = 5
    assert(body.length === 5, `Expected 5 UserPost links, got ${body.length}`);
  });

  test('POST with inline relationship referencing an existing entity', async () => {
    // Post 100 ("First Post") already exists from earlier tests.
    // This should create User 202 and link it to the existing Post 100
    // without creating a duplicate Post.
    const res = await post('/HRT/User', {
      id: 202,
      name: 'ExistingRefUser',
      email: 'existref@test.com',
      UserPost: { id: 100, title: 'First Post' },
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.User, 'Response should contain User');
    assert(body.User.id === 202);
  });

  test('existing entity is not duplicated after inline relationship POST', async () => {
    const res = await get('/HRT/Post', { id: '100' });
    assert(res.ok);
    const body = await res.json();
    assert(body.length === 1, `Expected exactly 1 Post with id 100, got ${body.length}`);
    assert(body[0].Post.title === 'First Post');
  });

  test('inline relationship link to existing entity is queryable', async () => {
    const res = await get('/HRT/UserPost');
    assert(res.ok);
    const body = await res.json();
    // 5 previous links + 1 new link (User 202 <-> Post 100) = 6
    assert(body.length === 6, `Expected 6 UserPost links, got ${body.length}`);
  });
});

// ──────────────────────────────────────────────────────────────────
// Edge Cases and Error Handling
// ──────────────────────────────────────────────────────────────────

describe('Error Handling', () => {
  test('POST to non-existent entity returns error', async () => {
    const res = await post('/HRT/NonExistent', { id: 1 });
    assert(!res.ok, 'Should fail for non-existent entity');
  });

  test('GET non-existent entity returns error', async () => {
    const res = await get('/HRT/NonExistent');
    assert(!res.ok, 'Should fail for non-existent entity');
  });

  test('GET / returns application info', async () => {
    const res = await get('/');
    assert(res.ok);
    const body = await res.json();
    assert(body.agentlang, 'Should have agentlang key');
    assert(body.agentlang.application === 'test-app@0.0.1');
  });
});
