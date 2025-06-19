import { makeCoreModuleName, makeFqName } from '../util.js';

export const CoreAIModuleName = makeCoreModuleName('ai');

export default `module ${CoreAIModuleName}

event agent {
    name String,
    type @oneof("chat", "planner") @default("chat"),
    providerConfig Map @optional,
    instruction String @optional,
    tools String[] @optional,
    documents String[] @optional,
    provider Any @readonly
}`;

export const AgentFqName = makeFqName(CoreAIModuleName, 'agent');
