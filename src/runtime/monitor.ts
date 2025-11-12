import { Instance, isAgentEventInstance } from './module.js';
import { disableInternalMonitoring, enableInternalMonitoring } from './state.js';

export class MonitorEntry {
  private input: string;
  private result: any = undefined;
  private error: string | undefined = undefined;
  private timestamp: number;
  private latencyMs: number;
  private llm: boolean = false;
  private llmPrompt: string | undefined;
  private llmResponse: string | undefined;
  private planner: boolean = false;
  private flowStep: boolean = false;
  private flow: boolean = false;
  private decision: boolean = false;

  constructor(statement: string) {
    this.input = statement;
    this.timestamp = Date.now();
    this.latencyMs = -1;
  }

  getStatement(): string {
    return this.input;
  }

  setResult(result: any): MonitorEntry {
    if (this.result === undefined) {
      this.result = result;
      this.error = undefined;
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

  flagAsLlm(): MonitorEntry {
    this.llm = true;
    return this;
  }

  setLlmPrompt(s: string): MonitorEntry {
    this.llm = true;
    if (this.llmPrompt === undefined) this.llmPrompt = s;
    return this;
  }

  setLlmResponse(s: string): MonitorEntry {
    if (this.llmResponse === undefined) this.llmResponse = s;
    return this;
  }

  flagAsPlanner(): MonitorEntry {
    this.llm = true;
    if (this.flowStep || this.flow || this.decision) {
      this.planner = false;
    } else {
      this.planner = true;
    }
    return this;
  }

  flagAsFlowStep(): MonitorEntry {
    this.llm = true;
    if (this.flow) {
      return this;
    }
    this.planner = false;
    this.flowStep = true;
    return this;
  }

  flagAsFlow(): MonitorEntry {
    this.llm = true;
    this.planner = false;
    this.flowStep = false;
    this.flow = true;
    return this;
  }

  flagAsDecision(): MonitorEntry {
    this.llm = true;
    this.planner = false;
    this.decision = true;
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
      obj.finalResult = MonitorEntry.resultAsObject(this.result);
    }
    if (this.llm === true) {
      const llmObj: any = {};
      if (this.llmPrompt !== undefined) {
        llmObj.prompt = this.llmPrompt;
      }
      if (this.llmResponse !== undefined) {
        llmObj.response = this.llmResponse;
      }
      llmObj.isPlanner = this.planner;
      llmObj.isFlowStep = this.flowStep;
      llmObj.isDecision = this.decision;
      llmObj.isFlow = this.flow;
      obj.llm = llmObj;
    }
    obj.label = this.input;
    return obj;
  }
}

let MonitoringCallback: Function | undefined = undefined;

export function setMonitoringCallback(f: Function) {
  MonitoringCallback = f;
  enableInternalMonitoring();
}

export function resetMonitoringCallback() {
  MonitoringCallback = undefined;
  disableInternalMonitoring();
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
  private timestamp: number;

  private static MAX_REGISTRY_SIZE = 25;

  constructor(eventInstance?: Instance | undefined, user?: string | undefined) {
    this.eventInstance = eventInstance;
    this.id = eventInstance ? eventInstance.getId() : crypto.randomUUID();
    this.user = user;
    this.timestamp = Date.now();
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

  setEntryResult(result: any): Monitor {
    if (this.lastEntry !== undefined) {
      this.lastEntry.setResult(result);
      this.finalizeLastEntry();
    }
    return this;
  }

  setEntryError(reason: string): Monitor {
    if (this.lastEntry !== undefined) {
      this.lastEntry.setError(reason);
      this.finalizeLastEntry();
    }
    return this;
  }

  flagEntryAsLlm(): Monitor {
    if (this.lastEntry !== undefined) {
      this.lastEntry.flagAsLlm();
    }
    return this;
  }

  flagEntryAsPlanner(): Monitor {
    if (this.lastEntry !== undefined) {
      this.lastEntry.flagAsPlanner();
    }
    return this;
  }

  flagEntryAsFlowStep(): Monitor {
    if (this.lastEntry !== undefined) {
      this.lastEntry.flagAsFlowStep();
    }
    return this;
  }

  flagEntryAsFlow(): Monitor {
    if (this.lastEntry !== undefined) {
      this.lastEntry.flagAsFlow();
    }
    return this;
  }

  flagEntryAsDecision(): Monitor {
    if (this.lastEntry !== undefined) {
      this.lastEntry.flagAsDecision();
    }
    return this;
  }

  setEntryLlmPrompt(s: string): Monitor {
    if (this.lastEntry !== undefined) {
      this.lastEntry.setLlmPrompt(s);
    }
    return this;
  }

  setEntryLlmResponse(s: string): Monitor {
    if (this.lastEntry !== undefined) {
      this.lastEntry.setLlmResponse(s);
    }
    return this;
  }

  private finalizeLastEntry(): void {
    if (this.lastEntry) {
      const ms = Date.now() - this.lastEntrySetAtMs;
      this.lastEntry.setLatencyMs(ms);
      if (MonitoringCallback !== undefined) {
        MonitoringCallback(this.lastEntry);
      }
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
    const r: any = { id: this.id, totalLatencyMs: this.totalLatency, flow: objs };
    if (this.eventInstance) {
      const n = this.eventInstance.getFqName();
      const inst = this.eventInstance.asSerializableObject();
      if (isAgentEventInstance(this.eventInstance)) {
        r.agent = n;
        r.agentInstance = inst;
      } else {
        r.event = n;
        r.eventInstance = inst;
      }
      r.label = n;
    }
    if (this.user) {
      r.user = this.user;
    }
    r.timestamp = this.timestamp;
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

export function identifyMonitorNode(monitorNode: any): 'event' | 'agent' | 'decision' | 'flow' {
  if (monitorNode.agent) {
    return 'agent';
  } else if (monitorNode.llm?.isFlowStep) {
    return 'flow';
  } else if (monitorNode.llm?.isDecision) {
    return 'decision';
  } else if (monitorNode.llm) {
    return 'agent';
  } else {
    return 'event';
  }
}
