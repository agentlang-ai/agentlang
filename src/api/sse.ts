import { Response } from 'express';

export class SseEmitter {
  private res: Response;
  private closed: boolean = false;
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined;

  constructor(res: Response) {
    this.res = res;
  }

  initialize(): void {
    this.res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    this.res.write(': connected\n\n');

    this.keepAliveTimer = setInterval(() => {
      if (!this.closed) {
        this.res.write(': keepalive\n\n');
      }
    }, 15000);

    this.res.on('close', () => {
      this.close();
    });
  }

  send(eventType: string, data: object): void {
    if (this.closed) return;
    this.res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  sendResult(result: any): void {
    this.send('result', { result });
    this.close();
  }

  sendError(error: string, statusCode?: number): void {
    this.send('error', { error, statusCode });
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
    this.res.end();
  }

  isClosed(): boolean {
    return this.closed;
  }
}

export function isStreamingRequest(acceptHeader: string | undefined): boolean {
  return acceptHeader !== undefined && acceptHeader.includes('text/event-stream');
}
