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
  private entries: (MonitorEntry | Monitor)[] = new Array<MonitorEntry | Monitor>();
  private parent: Monitor | undefined = undefined;
  private lastEntry: MonitorEntry | undefined = undefined;

  constructor(id?: string) {
    this.id = id ? id : crypto.randomUUID();
    monitorRegistry.push(this);
  }

  getId(): string {
    return this.id;
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
        objs.push({ entries: entry.asObject() });
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
