import { makeFqName } from '../util.js';

export type FlowSpec = string;
export type FlowStep = string;

const AgentFlows = new Map<string, string[]>();
const FlowRegistry = new Map<string, FlowSpec>();

export function registerFlow(name: string, flow: FlowSpec): string {
  FlowRegistry.set(name, flow);
  return name;
}

function getFlow(name: string): FlowSpec | undefined {
  return FlowRegistry.get(name);
}

export function registerAgentFlow(agentName: string, flowSpecName: string): string {
  let currentFlows = AgentFlows.get(agentName);
  if (currentFlows) {
    currentFlows.push(flowSpecName);
  } else {
    currentFlows = new Array<string>();
    currentFlows.push(flowSpecName);
  }
  AgentFlows.set(agentName, currentFlows);
  return agentName;
}

// Return the first flow registered with the agent.
export function getAgentFlow(agentName: string, moduleName: string): FlowSpec | undefined {
  const currentFlows = AgentFlows.get(agentName);
  if (currentFlows) {
    return getFlow(currentFlows[0]);
  } else {
    return getFlow(makeFqName(moduleName, agentName));
  }
}
