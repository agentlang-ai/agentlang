<div align="center">

# AgentLang - Reliable Enterprise AI Agents
Agentic Reliability Modeling - Build AI Agents that actually work!

|             |                                                              |
| ----------- | ------------------------------------------------------------ |
| CI/CD       | [![AgentLang CI](https://github.com/agentlang-ai/agentlang/actions/workflows/ci.yml/badge.svg)](https://github.com/agentlang-ai/agentlang/actions/workflows/ci.yml) |
| Quick Start | [![Documentation](https://img.shields.io/badge/docs-available-brightgreen)](https://github.com/agentlang-ai/agentlang#readme) [![Examples](https://img.shields.io/badge/examples-available-yellow)](https://github.com/agentlang-ai/agentlang/tree/main/example) |
| Environment | [![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?logo=node.js)](https://nodejs.org) [![pnpm](https://img.shields.io/badge/pnpm-10.13.1-blue?logo=pnpm)](https://pnpm.io) |
| Meta        | [![GitHub Stars](https://img.shields.io/github/stars/agentlang-ai/agentlang?style=social)](https://github.com/agentlang-ai/agentlang) ![License](https://img.shields.io/badge/License-Sustainable%20Use%20v1.0-blue.svg) [![npm downloads](https://img.shields.io/npm/dm/agentlang.svg)](https://www.npmjs.com/package/agentlang) |

</div>

Build **teams of reliable AI Agents** that follow your organization's processes closely, while adapting to new scenarios, with AgentLang. Agents collaborate with each other and humans to handle complex, time-consuming, monotonous tasks and get work done!

* **Agentic:** AgentLang is a programming language specifically designed for building anything involving agents. AgentLang is highly declarative - enabling you to focus on the business logic getting bogged down in implementation details.

* **Robust Integrations:** The AgentLang runtime integrates natively with a wide range of LLMs, databases, vector databases, and auth providers. AgentLang has a novel connector architecture, with a rapidly growing collection of prebuilt connectors for Enterprise tools. Plus, AgentLang programs run on NodeJS (and, soon, in the browser!) and can leverage any existing JavaScript library.

* **Production-ready**: AgentLang is built on top of TypeScript and uses all the modern JS/TS tooling needed to build production-grade agents and apps.

</div>

Coming soon! Fractl Studio is a no-code environment for building and operating AI Agents.

## First-class AI Agents

Agents and many concepts agents use are built-in language constructs.

```
// flows are business process definitions that "guide" (not enforce) the agent's behavior
flow triageFlow {
    ticketTriager --> "DNS" ticketInProgress
    ticketTriager --> "WLAN" ticketInProgress
    ticketTriager --> "NotEnoughInfo" ticketPending
}

agent NetOps {
    llm "ticketflow_llm",
    role "You are a network ticket management application. Your job is to triage any ticket passed to you and update the ticket with appropriate assigned_to, status and triaging comments.",
    flows [triageFlow]
}

```

## Agentic Reliability Modeling

Depending solely only on instructions for agents is a recipe for failure. Natural language is beautiful, but ambiguous - we don't want to be stuck in an endless prompt-tweaking cycle to make our agents work. AgentLang offers a robust set of tools to model various aspects of your agents - unambiguously, but still effortlessly - to make them reliable:
1. [Flows](#flows)
2. [Decisions](#decisions)
3. [Directives](#directives)
4. [Scenarios](#scenarios)
5. [Glossary](#glossary)
6. [Response schema and scratchpad](#response-schema-and-scratchpad)
7. [Templatized instructions](#templatized-instructions)

### Flows
Flows are central to AgentLang's reliability modeling. Define your business processes using an intuitive flow syntax. AgentLang's adaptive runtime will execute them, dynamically adapting to handle new scenarios as needed.

Each step in the flow can be an agent or a tool (workflow).

### Decisions

An agent that takes a decision for branching in a flow can be expressed as a **decision table** of `case` expressions. Each `case` specifies a condition as pure text or a logical expression. The consequence of a `case` will be a tag that tells the flow-evaluator which node to branch to.

```
decision classifyOrder {
   case (carType == "SUV" and segment == "economy") {
      EconomySUV
   }

   case (carType == "SUV" and segment == "luxury") {
      LuxurySUV
   }
}

flow carOrderRequestManager {
   analyseCarOrderRequest --> classifyOrder
   classifyOrder --> "EconomySUV" orderEconomySUV
   classifyOrder --> "LuxurySUV" orderLuxurySUV
}
```

The `case` conditions may also be written in plain text as:

```
case ("if carType is SUV and segment is economy") {
   EconomySUV
}
```

As the flow executes an agent that specializes in evaluating decision tables will be invoked for the node `classifyOrder`. The tag returned by this agent will be used to select either the `orderEconomySUV` or `orderLuxurySUV` node of the flow.

### Directives

**Directives** enhance the decision making capability of agents by providing precise actions to be taken under specific conditions.

```
agent salaryHikeAgent {
    instruction "Give an employee a salary-hike based on his/her sales performance",
    tools acme/employee,
    directives [{"if": "employee sales exceeded 5000", "then": "Give a salary hike of 5 percent"},
                {"if": "sales is more than 2000 but less than 5000", "then": "hike salary by 2 percent"}]
}
```

As the `salaryHikeAgent` tries to compute the salary-increment for a particular employee, the directives will guide it to take a more accurate decision based on specific conditions.

### Scenarios

**Scenarios** provide agents with concrete examples of user-requests and their corresponding LLM-responses.

```
agent salaryHikeAgent {
    instruction "Give an employee a salary-hike based on his/her sales performance",
    tools acme/employee,
    directives [{"if": "employee sales exceeded 5000", "then": "Give a salary hike of 5 percent"},
                {"if": "sales is more than 2000 but less than 5000", "then": "hike salary by 2 percent"}],
    scenarios  [{"user": "Jake hit a jackpot!", "ai": "acme/scenario01"}]
}

scenario salaryHikeAgent.jackpot {
    user "Jake hit a jackpot!"
}

workflow salaryHikeAgent.jackpot {
  {acme/employee {name? "Jake"}} @as [employee];
  {acme/employee {id? employee.id,
                  salary employee.salary + employee.salary * 0.5}}
}
```

Here, the provided scenario helps the agent to take a well-specified action in the case an employee is said to have hit a "jackpot".

### Glossary

**Glossaries** help the agent understand the meaning of domain-specific vocabulary that the user may use while interacting with the agent.

```
agent campaignAnalyzer {
    instruction "Evaluate and optimize marketing campaign performance based on key performance indicators (KPIs) and assign a performance rating",
    tools acme/campaign_eval,
    // ...
    glossary [
        {"name": "outstanding", "meaning": "CTR ≥ 5%, Conversion Rate ≥ 10%, ROI ≥ 50%", "synonyms": "exceptional, high-impact"},
        {"name": "satisfactory", "meaning": "CTR 2-4.9%, Conversion Rate 5-9.9%, ROI 20-49%", "synonyms": "solid, effective"},
        {"name": "underperforming", "meaning": "CTR < 2%, Conversion Rate < 5%, ROI < 20%", "synonyms": "needs improvement, low-impact"}
    ]
}
```

### Response Schema and Scratchpad

In certain scenarios, agents perform better with structured data than plain text. You can configure an agent to output responses in a specific format, enabling another agent to efficiently parse and utilize the relevant information as input.

```
module NetOps

record NetworkProvisioningRequest {
    type @enum("DNS", "WLAN"),
    requestedBy String,
    CNAME String,
    IPAddress String
}

agent classifyProvisioningRequest {
    instruction "Analyse the network provisioning request and return its type and other relevant information.",
    responseSchema NetworkProvisioningRequest
}
```
This kind of structured data (as entity or record instances) returned by an agent is added to an internal-cache used by the flow. This cache is known as *scratchpad*. 

### Templatized Instructions

An agent further down the flow can access the scratchpad using template parameters embedded in its instructions, denoted by `{{ }}`. For instance, the `ticketUpdater` agent makes reference to the scratchpad via the parameters `{{classifyProvisioningRequest.type}}` and `{{classifyProvisioningRequest.requestedBy}}`. (The references need not include the agent name and simply be `{{type}}` and `{{requestedBy}}`). This means, the actual instruction the `ticketUpdater` agent will see in this context will be `""Use type=DNS, requestedBy=joe@acme.com and provisioningId={{provisioningId}} to mark the request as completed"` - obviously enhancing its focus on the current context for more deterministic actions.

```
agent ticketUpdater {
    instruction "Use type={{classifyProvisioningRequest.type}}, requestedBy={{classifyProvisioningRequest.requestedBy}} and provisioningId={{provisioningId}} to mark the request as completed",
    tools [Networking/markRequestCompleted]
}

// agent/workflow definitions for provisionDNS, reportFailure etc

flow networkProvisioningRequestManager {
    classifyProvisioningRequest --> "type is DNS" provisionDNS
    classifyProvisioningRequest --> "type is WLAN" provisionWLAN
    classifyProvisioningRequest --> "type is Other" reportFailure
    provisionDNS --> ticketUpdater
    provisionWLAN --> ticketUpdater
}
```

The agent `classifyProvisioningRequest` has its `responseSchema` attribute set to the record `NetworkProvisioningRequest`. This means for a request like `"Provision DNS joe.acme.com for 192.3.4.1 as requested by joe@acme.com"` this agent will return:

```
{type "DNS", requestedBy "joe@acme.com", CNAME "joe.acme.com", IPAddress "192.3.4.1"}
```


## AgentLang Ontology

Agentlang's sophisticated modeling capabilities allow you to design the data-schema, workflows and access control constructs of your application in a declarative way. Agents can work directly with this ontology and dynamically generate business workflows, making your application into a living system that constantly adapts to new requirements and demands.

To get started with Agentlang Ontology, please see the [quick start](link-to-doc) guide or explore the following example applications:

// TODO: links to example apps

## Build Agentlang from Source

```shell
# Install dependencies with pnpm (recommended over npm - 90% faster)
# Get pnpm: https://pnpm.io/installation
pnpm install

# Or use npm
npm install

# Build
npm run build

# Run test
npm test
```

> **Note**: If pnpm shows build script warnings, run `pnpm approve-builds` and approve esbuild and sqlite3.

## Run an Agentlang Script or Application

```shell
# Parse and validate an AgentLang file
node ./bin/cli.js parseAndValidate example/blog/blog.al

# Run a specific app
node ./bin/cli.js run example/blog
```

## Development

```shell
# Linting and formatting
npm run lint
npm run lint -- --fix
npm run format
```
