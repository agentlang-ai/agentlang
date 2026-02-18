import { assert, describe, test } from 'vitest';
import { SseEmitter, isStreamingRequest } from '../../src/api/sse.js';

function mockResponse(): { res: any; written: string[]; state: { ended: boolean; headers: any } } {
  const state = {
    written: [] as string[],
    ended: false,
    headers: {} as any,
    closeHandler: null as Function | null,
  };
  const res = {
    writeHead(_status: number, headers: any) {
      state.headers = headers;
    },
    write(chunk: string) {
      state.written.push(chunk);
    },
    end() {
      state.ended = true;
    },
    on(event: string, handler: Function) {
      if (event === 'close') state.closeHandler = handler;
    },
  };
  return { res, written: state.written, state };
}

describe('SseEmitter', () => {
  test('initialize writes SSE headers and connected comment', () => {
    const mock = mockResponse();
    const emitter = new SseEmitter(mock.res);
    emitter.initialize();

    assert(
      mock.state.headers['Content-Type'] === 'text/event-stream',
      'Content-Type should be text/event-stream'
    );
    assert(mock.state.headers['Cache-Control'] === 'no-cache', 'Cache-Control should be no-cache');
    assert(mock.state.headers['Connection'] === 'keep-alive', 'Connection should be keep-alive');
    assert(mock.state.headers['X-Accel-Buffering'] === 'no', 'X-Accel-Buffering should be no');
    assert(mock.written.length >= 1, 'Should have written connected comment');
    assert(mock.written[0] === ': connected\n\n', 'First write should be connected comment');

    emitter.close();
  });

  test('send writes event and data in SSE format', () => {
    const mock = mockResponse();
    const emitter = new SseEmitter(mock.res);
    emitter.initialize();

    emitter.send('my_event', { foo: 'bar' });

    const eventMsg = mock.written.find(w => w.startsWith('event:'));
    assert(eventMsg !== undefined, 'Should have written an event message');
    assert(
      eventMsg === 'event: my_event\ndata: {"foo":"bar"}\n\n',
      'Event format should be correct'
    );

    emitter.close();
  });

  test('send accepts arbitrary event type strings', () => {
    const mock = mockResponse();
    const emitter = new SseEmitter(mock.res);
    emitter.initialize();

    emitter.send('custom_progress_update', { step: 1, total: 5 });
    emitter.send('another-type', { x: true });

    const events = mock.written.filter(w => w.startsWith('event:'));
    assert(events.length === 2, 'Should have written two events');
    assert(
      events[0].startsWith('event: custom_progress_update\n'),
      'First event type should match'
    );
    assert(events[1].startsWith('event: another-type\n'), 'Second event type should match');

    emitter.close();
  });

  test('send no-ops after close', () => {
    const mock = mockResponse();
    const emitter = new SseEmitter(mock.res);
    emitter.initialize();

    emitter.close();
    const countBefore = mock.written.length;

    emitter.send('should_not_appear', { data: 'ignored' });
    assert(mock.written.length === countBefore, 'No new writes after close');
  });

  test('close is idempotent', () => {
    const mock = mockResponse();
    const emitter = new SseEmitter(mock.res);
    emitter.initialize();

    assert(!emitter.isClosed(), 'Should not be closed initially');
    emitter.close();
    assert(emitter.isClosed(), 'Should be closed after first close');
    emitter.close();
    assert(emitter.isClosed(), 'Should still be closed after second close');
  });

  test('sendResult sends result event then closes', () => {
    const mock = mockResponse();
    const emitter = new SseEmitter(mock.res);
    emitter.initialize();

    emitter.sendResult({ answer: 42 });

    const resultEvent = mock.written.find(w => w.startsWith('event: result\n'));
    assert(resultEvent !== undefined, 'Should have written a result event');
    assert(resultEvent!.includes('"answer":42'), 'Result should contain the data');
    assert(emitter.isClosed(), 'Should be closed after sendResult');
  });

  test('sendError sends error event with statusCode then closes', () => {
    const mock = mockResponse();
    const emitter = new SseEmitter(mock.res);
    emitter.initialize();

    emitter.sendError('something broke', 500);

    const errorEvent = mock.written.find(w => w.startsWith('event: error\n'));
    assert(errorEvent !== undefined, 'Should have written an error event');
    assert(errorEvent!.includes('"error":"something broke"'), 'Error message should be present');
    assert(errorEvent!.includes('"statusCode":500'), 'Status code should be present');
    assert(emitter.isClosed(), 'Should be closed after sendError');
  });

  test('client disconnect sets closed via res close handler', () => {
    let closeHandler: Function | null = null;
    const res = {
      writeHead() {},
      write() {},
      end() {},
      on(event: string, handler: Function) {
        if (event === 'close') closeHandler = handler;
      },
    };
    const emitter = new SseEmitter(res as any);
    emitter.initialize();

    assert(!emitter.isClosed(), 'Should not be closed before client disconnect');
    assert(closeHandler !== null, 'Should have registered a close handler');
    closeHandler!();
    assert(emitter.isClosed(), 'Should be closed after client disconnect');
  });
});

describe('isStreamingRequest', () => {
  test('returns true for text/event-stream', () => {
    assert(isStreamingRequest('text/event-stream') === true);
  });

  test('returns true when text/event-stream is part of a list', () => {
    assert(isStreamingRequest('text/event-stream, application/json') === true);
  });

  test('returns false for application/json', () => {
    assert(isStreamingRequest('application/json') === false);
  });

  test('returns false for undefined', () => {
    assert(isStreamingRequest(undefined) === false);
  });
});
