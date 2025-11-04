import { Instance } from './module.js';

export class MonitorEntry {
  private input: string;
  private result: any = undefined;
  private error: string | undefined = undefined;
  private timestamp: number;
  private latencyMs: number;

  constructor(statement: string) {
    this.input = statement;
    this.timestamp = Date.now();
    this.latencyMs = -1;
  }

  getStatement(): string {
    return this.input;
  }

  setResult(result: any): MonitorEntry {
    if (this.error === undefined) {
      this.result = result;
    }
    return this;
  }

  getResult(): any {
    return this.result;
  }

  setError(error: string): MonitorEntry {
    this.error = error;
    this.result = undefined;
    return this;
  }

  getError(): string | undefined {
    return this.error;
  }

  setLatencyMs(ms: number): MonitorEntry {
    this.latencyMs = ms;
    return this;
  }

  private static resultAsObject(result: any): object {
    if (result instanceof Instance) return result.asSerializableObject();
    else if (result instanceof Array)
      return result.map((v: any) => {
        return MonitorEntry.resultAsObject(v);
      });
    else return result;
  }

  asObject(): object {
    const obj: any = {
      input: this.input,
      timestamp: this.timestamp,
    };
    if (this.latencyMs >= 0) {
      obj.latencyMs = this.latencyMs;
    }
    if (this.error !== undefined) {
      obj.error = this.error;
    } else if (this.result !== undefined) {
      obj.result = MonitorEntry.resultAsObject(this.result);
    }
    return obj;
  }
}

export class Monitor {
  private id: string;
  private eventInstance: Instance | undefined;
  private user: string | undefined;
  private entries: (MonitorEntry | Monitor)[] = new Array<MonitorEntry | Monitor>();
  private parent: Monitor | undefined = undefined;
  private lastEntry: MonitorEntry | undefined = undefined;
  private lastEntrySetAtMs: number = 0;
  private totalLatency: number = 0;

  private static MAX_REGISTRY_SIZE = 25;

  constructor(eventInstance?: Instance | undefined, user?: string | undefined) {
    this.eventInstance = eventInstance;
    this.id = eventInstance ? eventInstance.getId() : crypto.randomUUID();
    this.user = user;
    while (monitorRegistry.length >= Monitor.MAX_REGISTRY_SIZE) {
      monitorRegistry.shift();
    }
    monitorRegistry.push(this);
  }

  getId(): string {
    return this.id;
  }

  getEventInstance(): Instance | undefined {
    return this.eventInstance;
  }

  getUser(): string | undefined {
    return this.user;
  }

  getTotalLatencyMs(): number {
    return this.totalLatency;
  }

  addEntry(entry: MonitorEntry): Monitor {
    this.entries.push(entry);
    this.lastEntry = entry;
    this.lastEntrySetAtMs = Date.now();
    return this;
  }

  setLastResult(result: any): Monitor {
    if (this.lastEntry !== undefined) {
      this.lastEntry.setResult(result);
      this.finalizeLastEntry();
    }
    return this;
  }

  setLastError(reason: string): Monitor {
    if (this.lastEntry !== undefined) {
      this.lastEntry.setError(reason);
      this.finalizeLastEntry();
    }
    return this;
  }

  private finalizeLastEntry(): void {
    if (this.lastEntry) {
      const ms = Date.now() - this.lastEntrySetAtMs;
      this.lastEntry.setLatencyMs(ms);
      this.lastEntry = undefined;
      this.totalLatency += ms;
    }
  }

  increment(): Monitor {
    const m = new Monitor();
    m.parent = this;
    this.entries.push(m);
    return m;
  }

  decrement(): Monitor {
    if (this.parent !== undefined) {
      return this.parent;
    }
    return this;
  }

  asObject(): object {
    const objs = new Array<object>();
    this.entries.forEach((entry: Monitor | MonitorEntry) => {
      objs.push(entry.asObject());
    });
    const r: any = { id: this.id, totalLatencyMs: this.totalLatency, graph: objs };
    if (this.eventInstance) {
      r.event = this.eventInstance.getFqName();
    }
    if (this.user) {
      r.user = this.user;
    }
    return r;
  }
}

const monitorRegistry = new Array<Monitor>();

export function getMonitor(id: string): Monitor | undefined {
  return monitorRegistry.filter((m: Monitor) => {
    return m.getId() === id;
  })[0];
}

export function getMonitorsForEvent(eventName: string): Monitor[] {
  return monitorRegistry.filter((m: Monitor) => {
    return m.getEventInstance()?.getFqName() === eventName;
  });
}
