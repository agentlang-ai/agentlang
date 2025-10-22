
<div align="center">

<p>
  <a href="https://zdoc.app/ja/agentlang-ai/agentlang">日本語</a> |
  <a href="https://zdoc.app/es/agentlang-ai/agentlang">Español</a> |
  <a href="https://zdoc.app/fr/agentlang-ai/agentlang">français</a> |
  <a href="https://zdoc.app/de/agentlang-ai/agentlang">Deutsch</a> |
  <a href="https://zdoc.app/pt/agentlang-ai/agentlang">Português</a> |
  <a href="https://zdoc.app/ru/agentlang-ai/agentlang">Русский</a> |
  <a href="https://zdoc.app/ko/agentlang-ai/agentlang">한국어</a> |
  <a href="https://zdoc.app/zh/agentlang-ai/agentlang">中文</a>
</p>

<div id="toc"> <!-- both work, toc or user-content-toc -->
  <ul style="list-style: none;">
    <summary>
      <h1>Agentlang - Reliable Enterprise AI Agents</h1>
    </summary>
  </ul>
</div>


<a href="https://agentlang-ai.fractl.io"><img src="https://img.shields.io/badge/Project-Home-blue?logo=homepage&logoColor=blue&style=for-the-badge"></a>
<a href="https://discord.gg/abcdef"><img src="https://img.shields.io/badge/Discord-Join%20Us-purple?logo=discord&logoColor=red&style=for-the-badge"></a>
<a href="https://github.com/agentlang-ai/agentlang/tree/main/example"><img src="https://img.shields.io/badge/Examples-Page-yellow?logo=homepage&logoColor=yellow&style=for-the-badge"></a>

[![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?logo=node.js)](https://nodejs.org) [![CI](https://github.com/agentlang-ai/agentlang/actions/workflows/ci.yml/badge.svg)](https://github.com/agentlang-ai/agentlang/actions/workflows/ci.yml)![License](https://img.shields.io/badge/License-Sustainable%20Use%20v1.0-blue.svg) [![npm downloads](https://img.shields.io/npm/dm/agentlang.svg)](https://www.npmjs.com/package/agentlang)
<hr>

<div id="toc"> <!-- both work, toc or user-content-toc -->
  <ul style="list-style: none;">
    <summary>
      <h2>🎯 Agentic Reliability Modeling - Build AI Agents that actually work!</h2>
    </summary>
  </ul>
</div>

</div>

Build **teams of reliable AI Agents** that follow your organization's processes closely, while adapting to new scenarios. Agents collaborate with each other and humans to handle complex, time-consuming, monotonous tasks and get work done!

* **Agentic:** Agentlang is a programming abstraction specifically designed for building anything involving agents. Agentlang is highly declarative - enabling you to focus on the business logic without getting bogged down in implementation details.

* **Robust Integrations:** The Agentlang runtime integrates natively with a wide range of LLMs, databases, vector databases, and auth providers. Agentlang has a novel connector architecture, with a rapidly growing collection of prebuilt connectors for Enterprise tools. Plus, Agentlang programs run on NodeJS (and in the browser) and can leverage any existing JavaScript library.

* **Production-grade**: Agentlang is built on top of TypeScript and uses all the modern JS/TS tooling needed to build enterprise-class agents and apps.

> Coming soon! Fractl Studio is a no-code environment for building and operating AI Agents.

The two key innovations in AgentLang are: [Agentic Reliability Modeling](#agentic-reliabillity-modeling) and [AgentLang Ontology](#agentlang-ontology)

## Agentic Reliability Modeling

Depending solely only on instructions for agents is a recipe for failure. Natural language is beautiful, but ambiguous - forcing us to be stuck in an endless cycle of prompt-tweaking to achieve our goal. Agentlang offers **just enough structure**, to augment natural language instructions, to model various aspects of your agents - unambiguously, but still effortlessly - to make them reliable.

<table>
    <tr>
        <td valign="top">
          <div>
          <b>Agentic Reliability Features:</b>
          <ul>
<li> First-class AI Agents </li>
<li> Flows </li>
<li> Decisions </li>
<li> Directives </li>
<li> Scenarios </li>
<li> Glossary </li>
<li> Structured output and scratchpad </li>
<li> Input Template </li>
          </ul>
            <img width="441" height="1">
          </div>
        </td>
        <td>
          <div align="center">
          <img width="350" height="420" alt="image" src="https://github.com/user-attachments/assets/b240a235-3804-4423-a639-cdfb90f07282" />
          <img width="441" height="1">
          </div>
        </td>
    </tr>
</table>

### An Example

```typescript
flow TicketFlow {
    ticketTriager --> "DNS" ticketInProgress
    ticketTriager --> "WLAN" ticketInProgress
    ticketTriager --> "NotEnoughInfo" ticketPending
}

agent TicketFlow {
    llm "gpt4o",
    role "You are a network ticket management application. Your job is to triage any ticket passed to you
          and update the ticket with appropriate assigned_to, status and triaging comments.",
	glossary [
		{"name": "incident", "meaning": "a problem report", "synonyms": "ticket"},
		{"name": "task", "meaning": "a record that captures some work that needs to be done", "synonyms": "ticket"},
		{"name": "DNS", "meaning": "Domain Name Service - is used to translate human-readable domain names to IP addresses", "synonyms": "DNS name, CNAME, DNS HOST record"}
		{"name": "WLAN", "meaning": "Wireless LAN - wireless network to connect devices to each other and the internet", "synonyms": "Office network"}
]
}

decision ticketTriager {
   case ("Ticket is related to DNS provisioning. If the request is to point one host/DNS name to an IP address") {
      DNS
   }
   case ("Ticket is related to WLAN provisioning. If the request is to add/whitelist a MAC address on the wireless network") {
      WLAN
   }
   case ("There is not enough information in the ticket about what the category is") {
      NotEnoughInfo
   }
   default {
      Other
   }
}

workflow ticketInProgress {
    // workflow body is developer-written declarative code (not handled by LLM)
    ...
}
```


### ✨ First-class AI Agents

Agents and many concepts agents use are built-in language constructs.

```typescript
agent TicketFlow {
    llm "gpt4o",
    role "You are a network ticket management agent. Your job is to triage any ticket passed to you and
          update the ticket with appropriate assigned_to, status and triaging comments."
}

directive TicketFlow {
    "if": "the context indicates the ticket as handled", "then": "set status to done"
}
```

### Flows

Flows are central to Agentlang's reliability modeling. Define your business processes using an intuitive flow syntax - flows guide (not enforce) an agent's behavior closely. Agentlang's adaptive runtime will execute them, dynamically adapting the execution flow as needed.

Each step in the flow can be an agent or a tool (workflow).

```typescript
flow networkProvisioningRequestManager {
    classifyProvisioningRequest --> "DNS" provisionDNS
    classifyProvisioningRequest --> "WLAN" provisionWLAN
    classifyProvisioningRequest --> "Other" reportFailure
    provisionDNS --> ticketUpdater
    provisionWLAN --> ticketUpdater
}
```

### Decisions

An agent that takes a decision for branching in a flow can be expressed as a **decision table** of `case` expressions. Each `case` specifies a condition as pure text or a logical expression. The consequence of a `case` will be a tag that tells the flow-evaluator which node to branch to.

```typescript
decision classifyOrder {
    case ("if requested car type is SUV and customer tier is premier") {
      LuxurySUV
    }

    case ("if the requested car type is SUV and segment is economy") {
      EconomySUV
    }
}

flow carOrderRequestManager {
   analyseCarOrderRequest --> classifyOrder
   classifyOrder --> "EconomySUV" orderEconomySUV
   classifyOrder --> "LuxurySUV" orderLuxurySUV
}
```

The `case` conditions may also be written as logical expressions:

```typescript
   case (carType == "SUV" and segment == "luxury") {
      LuxurySUV
   }

   case (carType == "SUV") {
      EconomySUV
   }

```

As the flow executes an agent that specializes in evaluating decision tables will be invoked for the node `classifyOrder`. The tag returned by this agent will be used to select either the `orderEconomySUV` or `orderLuxurySUV` node of the flow.

### Directives

**Directives** enhance the decision making capability of agents by providing precise actions to be taken under specific conditions.

```typescript
agent salaryHikeAgent {
    instruction "Give an employee a salary-hike based on his/her sales performance",
    tools acme/employee
}

directive salaryHikeAgent.hike5p {"if": "employee sales exceeded 5000", "then": "Give a salary hike of 5 percent"}
directive salaryHikeAgent.hike2p {"if": "sales is more than 2000 but less than 5000", "then": "hike salary by 2 percent"}
```

As the `salaryHikeAgent` tries to compute the salary-increment for a particular employee, the directives will guide it to take a more accurate decision based on specific conditions.

### Scenarios

**Scenarios** provide agents with concrete examples of user-requests and their corresponding LLM-responses.

```typescript
agent salaryHikeAgent {
    instruction "Give an employee a salary-hike based on his/her sales performance",
    tools acme/employee
}

directive salaryHikeAgent.hike5p {"if": "employee sales exceeded 5000", "then": "Give a salary hike of 5 percent"}
directive salaryHikeAgent.hike2p {"if": "sales is more than 2000 but less than 5000", "then": "hike salary by 2 percent"}

scenario salaryHikeAgent.outperform {
    user "Jake's sale exceeded 5000"
}

workflow salaryHikeAgent.outperform {
  {acme/employee {email? "jake@acme.com"}} @as [employee];
  {acme/employee {id? employee.id,
                  salary employee.salary + employee.salary * 0.5}}
}
```

Here, the provided scenario helps the agent to take a well-specified action in the case an employee is said to have "outperformed".

### Glossary

**Glossaries** help the agent understand the meaning of domain-specific vocabulary that the user may use while interacting with the agent.

```typescript
agent campaignAnalyzer {
    instruction "Evaluate and optimize marketing campaign performance based on key performance indicators (KPIs) and assign a performance rating",
    tools acme/campaign_eval,
    // ...
}

glossaryEntry campaignAnalyzer.entry1 {
    "name": "outstanding",
	"meaning": "CTR ≥ 5%, Conversion Rate ≥ 10%, ROI ≥ 50%",
	"synonyms": "exceptional, high-impact"
}

glossaryEntry campaignAnalyzer.entry2 {
    "name": "satisfactory",
	"meaning": "CTR 2-4.9%, Conversion Rate 5-9.9%, ROI 20-49%",
	"synonyms": "solid, effective"
}

glossaryEntry campaignAnalyzer.entry3 {
    "name": "underperforming",
	"meaning": "CTR < 2%, Conversion Rate < 5%, ROI < 20%",
	"synonyms": "needs improvement, low-impact"
}
```

### Response Schema and Scratchpad

In certain scenarios, agents perform better with structured data than plain text. You can configure an agent to output responses in a specific format, enabling another agent to efficiently parse and utilize the relevant information as input.

```typescript
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

An agent further down the flow can access the scratchpad using template parameters (denoted by `{{}}`) embedded in its instructions/directives. For instance, the `ticketUpdater` agent makes reference to the scratchpad via the parameters `{{classifyProvisioningRequest.type}}` and `{{classifyProvisioningRequest.requestedBy}}`. (The references need not include the agent name and simply be `{{type}}` and `{{requestedBy}}`). The actual instruction the `ticketUpdater` agent will see in this context will be `""Use type=DNS, requestedBy=joe@acme.com and provisioningId={{provisioningId}} to mark the request as completed"` - obviously enhancing its focus on the current context for more deterministic actions.

```typescript
agent ticketUpdater {
    instruction "Use type={{classifyProvisioningRequest.type}}, requestedBy={{classifyProvisioningRequest.requestedBy}} and provisioningId={{provisioningId}} to mark the request as completed",
    tools [Networking/markRequestCompleted]
}

// insert agent/workflow definitions for provisionDNS, reportFailure etc

flow networkProvisioningRequestManager {
    classifyProvisioningRequest --> "DNS" provisionDNS
    classifyProvisioningRequest --> "WLAN" provisionWLAN
    classifyProvisioningRequest --> "Other" reportFailure
    provisionDNS --> ticketUpdater
    provisionWLAN --> ticketUpdater
}
```

The agent `classifyProvisioningRequest` has its `responseSchema` attribute set to the record `NetworkProvisioningRequest`. This means for a request like `"Provision DNS joe.acme.com for 192.3.4.1 as requested by joe@acme.com"` this agent will return:

```typescript
{type "DNS", requestedBy "joe@acme.com", CNAME "joe.acme.com", IPAddress "192.3.4.1"}
```

## Agentlang Ontology

Agentlang's sophisticated modeling capabilities allow you to design the data-schema, workflows and access control constructs of your application in a declarative way. Agents can work directly with this ontology and dynamically generate business workflows, making your application into a living system that constantly adapts to new requirements and demands.

This simple blogging application demonstrates Agentlang’s powerful data modeling and agent integration capabilities.

```typescript
module blog.core

entity Post {
    id UUID @id @default(uuid()),
    title String,
    content String,
    postedBy Email,
    createdAt DateTime @default(now()),
    @rbac [(roles: [manager], allow: [create, read])]
}

entity Comment {
   id UUID @id @default(uuid()),
   content String,
   postedBy Email,
   postedOn DateTime @default(now())
}

relationship PostComment contains(Post, Comment)

entity Category {
    id UUID @id @default(uuid()),
    name String
}

relationship PostCategory between(Post, Category)

@public agent postEditor {
    instruction "Create a new blog post based on the outline provided to you.",
    tools [blog.core/Post]
}
```

Entities like `Post`, `Comment`, and `Category` define a clear domain schema connected through declarative relationships such as `contains` and `between`. Access rules, like the `@rbac` annotation on posts, show how policies can be built directly into the model itself.

What makes this model special is how seamlessly an agent can interact with it — for instance, the `postEditor` agent can create new posts directly using the `Post` entity as a tool. This tight coupling between schema and agent logic allows intelligent automation to operate safely and predictably within a structured data framework.

To get started with Agentlang Ontology, please see the [Agentlang Tutorial](https://docs.fractl.io/app) or explore the following example applications:

 * [Car Dealership](https://github.com/agentlang-ai/agentlang/tree/main/example/car_dealership)
 * [Customer Support System](https://github.com/agentlang-ai/agentlang/tree/main/example/customer_support_system)

## 🚀 Getting Started

#### ⚡ Use npm or pnpm

```shell
npm install

OR

# Install pnpm: https://pnpm.io/installation
# Use pnpm
pnpm install
```
**Note**: If pnpm shows build script warnings, run `pnpm approve-builds` and approve esbuild and sqlite3.

### ⚡ Build

```shell
# Generate parser and build
npm run langium:generate
npm run build
```

### ⚡ Test

```shell
# Run all tests
npm test

# Run tests with verbose output
npm run test:verbose
```

## Run an Agentlang Script or Application

```shell
# Parse and validate an Agentlang file
node ./bin/cli.js parseAndValidate example/blog/blog.al

# Run a specific app
node ./bin/cli.js run example/blog
```

## Development

### Code Quality

```shell
# Lint code
npm run lint

# Lint and auto-fix issues
npm run lint:fix

# Format code
npm run format

# Check formatting without changes
npm run format:check
```

### Watch Mode

```shell
# Watch for changes and rebuild
npm run watch
```
