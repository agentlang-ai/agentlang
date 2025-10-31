import { Instance } from './module.js';

export class MonitorEntry {
  private statement: string;
  private result: any = undefined;
  private error: string | undefined = undefined;

  constructor(statement: string) {
    this.statement = statement;
  }

  getStatement(): string {
    return this.statement;
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

  asObject(): object {
    const obj: any = {
      statement: this.statement,
    };
    if (this.error !== undefined) {
      obj.error = this.error;
    } else if (this.result !== undefined) {
      obj.result = this.result;
    }
    return obj;
  }
}

export class Monitor {
  private id: string;
  private eventInstance: Instance | undefined;
  private entries: (MonitorEntry | Monitor)[] = new Array<MonitorEntry | Monitor>();
  private parent: Monitor | undefined = undefined;
  private lastEntry: MonitorEntry | undefined = undefined;

  private static MAX_REGISTRY_SIZE = 25;

  constructor(eventInstance?: Instance | undefined) {
    this.eventInstance = eventInstance;
    this.id = eventInstance ? eventInstance.getId() : crypto.randomUUID();
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

  addEntry(entry: MonitorEntry): Monitor {
    this.entries.push(entry);
    this.lastEntry = entry;
    return this;
  }

  setLastResult(result: any): Monitor {
    if (this.lastEntry !== undefined) {
      this.lastEntry.setResult(result);
    }
    return this;
  }

  setLastError(reason: string): Monitor {
    if (this.lastEntry !== undefined) {
      this.lastEntry.setError(reason);
    }
    return this;
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
      if (entry instanceof MonitorEntry) {
        objs.push(entry.asObject());
      } else {
        objs.push({
          entries: entry.asObject(),
          id: entry.id,
        });
      }
    });
    return objs;
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
