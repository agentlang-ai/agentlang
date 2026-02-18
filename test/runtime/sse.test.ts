import { assert, describe, test } from 'vitest';
import { Environment, evaluate } from '../../src/runtime/interpreter.js';
import { SseEmitter } from '../../src/api/sse.js';
import { doInternModule } from '../util.js';
import { makeInstance, newInstanceAttributes } from '../../src/runtime/module.js';

function mockResponse(): { res: any; written: string[] } {
  const state = { written: [] as string[] };
  const res = {
    writeHead() {},
    write(chunk: string) {
      state.written.push(chunk);
    },
    end() {},
    on() {},
  };
  return { res, written: state.written };
}

function collectSseEvents(written: string[]): Array<{ type: string; data: any }> {
  return written
    .filter(w => w.startsWith('event:'))
    .map(w => {
      const lines = w.trim().split('\n');
      const type = lines[0].replace('event: ', '');
      const data = JSON.parse(lines[1].replace('data: ', ''));
      return { type, data };
    });
}

describe('Environment.emitSseEvent', () => {
  test('no-ops when no emitter is set', () => {
    const env = new Environment('test-env');
    // Should not throw
    env.emitSseEvent('some_event', { key: 'value' });
  });

  test('emits event when emitter is set', () => {
    const mock = mockResponse();
    const emitter = new SseEmitter(mock.res);
    emitter.initialize();

    const env = new Environment('test-env');
    env.setSseEmitter(emitter);
    env.emitSseEvent('test_event', { hello: 'world' });

    const events = collectSseEvents(mock.written);
    assert(events.length === 1, 'Should have one event');
    assert(events[0].type === 'test_event', 'Event type should match');
    assert(events[0].data.hello === 'world', 'Event data should match');

    emitter.close();
  });

  test('no-ops when emitter is closed', () => {
    const mock = mockResponse();
    const emitter = new SseEmitter(mock.res);
    emitter.initialize();

    const env = new Environment('test-env');
    env.setSseEmitter(emitter);
    emitter.close();

    const countBefore = mock.written.length;
    env.emitSseEvent('should_not_appear', { ignored: true });
    assert(mock.written.length === countBefore, 'No new writes after emitter is closed');
  });

  test('child environment inherits sseEmitter from parent', () => {
    const mock = mockResponse();
    const emitter = new SseEmitter(mock.res);
    emitter.initialize();

    const parent = new Environment('parent');
    parent.setSseEmitter(emitter);

    const child = new Environment('child', parent);
    child.emitSseEvent('child_event', { from: 'child' });

    const events = collectSseEvents(mock.written);
    assert(events.length === 1, 'Child should emit via inherited emitter');
    assert(events[0].type === 'child_event', 'Event type from child should match');

    emitter.close();
  });

  test('getSseEmitter returns the set emitter', () => {
    const mock = mockResponse();
    const emitter = new SseEmitter(mock.res);

    const env = new Environment('test-env');
    assert(env.getSseEmitter() === undefined, 'Should be undefined initially');

    env.setSseEmitter(emitter);
    assert(env.getSseEmitter() === emitter, 'Should return the set emitter');
  });
});

describe('SSE integration with evaluate', () => {
  test('evaluate with SSE emitter produces result event', async () => {
    await doInternModule(
      'SseTest01',
      `entity Item {
          id Int @id,
          name String
        }
        workflow CreateItem {
          {Item {id CreateItem.id, name CreateItem.name}}
        }
      `
    );

    const mock = mockResponse();
    const emitter = new SseEmitter(mock.res);
    emitter.initialize();

    const env = new Environment('sse-test');
    env.setSseEmitter(emitter);

    const inst = makeInstance(
      'SseTest01',
      'CreateItem',
      newInstanceAttributes().set('id', 1).set('name', 'TestItem')
    );

    let resultReceived: any = undefined;
    await evaluate(
      inst,
      (value: any) => {
        resultReceived = value;
      },
      env
    );

    assert(resultReceived !== undefined, 'Should have received a result via continuation');

    // The emitter should still be functional (not closed by evaluate itself —
    // that's the HTTP handler's job via okSse/internalErrorSse)
    assert(!emitter.isClosed(), 'Emitter should still be open after evaluate');

    emitter.close();
  });
});
