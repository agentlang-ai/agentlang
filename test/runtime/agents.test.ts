import { assert, describe, test } from "vitest"
import { provider } from "../../src/runtime/agents/registry.js"
import { AgentServiceProvider, AIResponse, humanMessage, systemMessage } from "../../src/runtime/agents/provider.js"
import { doInternModule } from "../util.js"
import { parseAndEvaluateStatement } from "../../src/runtime/interpreter.js"
import { Agent, fetchModule, Instance, isInstanceOfType, newInstanceAttributes } from "../../src/runtime/module.js"
import { WorkflowDefinition } from "../../src/language/generated/ast.js"
import { parseWorkflow } from "../../src/language/parser.js"
import { addWorkflowFromDef } from "../../src/runtime/loader.js"

describe('Agent API', () => {
  test('Test Agent APIs for modules', async () => {
    await doInternModule('AAPI', `entity E {id Int @id}`)
    const m = fetchModule('AAPI')
    const ae01 = new Agent('agent01', m.name, newInstanceAttributes().set('llm', 'llm01').set('tools', 'X, Y'))
    m.addAgent(ae01)
    const ae02 = new Agent('agent02', m.name, newInstanceAttributes().set('llm', 'llm02'))
    m.addAgent(ae02)
    let agentNames = m.getAgentNames()
    assert(agentNames.length == 2)
    assert(agentNames.find((n: string) => { return n == 'agent01' }))
    assert(agentNames.find((n: string) => { return n == 'agent02' }))
    m.removeAgent('agent01')
    agentNames = m.getAgentNames()
    assert(agentNames.length == 1)
    assert(agentNames[0] == 'agent02')
    const ae = m.getAgent('agent02')
    ae?.attributes.set('tools', 'A, B')
    const str = m.toString()
    assert(str == `module AAPI

entity E
{
    id Int @id
}

agent agent02
{
    llm "llm02",
    tools "A, B"
}`)
  })
})

if (process.env.AL_TEST) {

  describe('Basic module operations', () => {
    test('check create module', async () => {
      const ai: AgentServiceProvider = new (provider("OpenAI"))()
      await ai.invoke([
        systemMessage("Is the following number odd? Answer YES or NO."),
        humanMessage("11")
      ]).then((result: AIResponse) => {
        assert(result.content == "YES", `Expected YES, got ${result.content}`)
      })
    })
  })

  describe('Basic agent', () => {
    test('Simple chat agent', async () => {
      await doInternModule('SimpleAIChat',
        `agent simpleChatAgent
          {instruction "Is the following number odd? Answer YES or NO.",
           llm "simpleChatLLM"}
          workflow chat {
            {simpleChatAgent {message chat.N}}
          }
          `)
      assert("NO" == await parseAndEvaluateStatement(`{SimpleAIChat/chat {N "12"}}`), 'Expected response was NO')
      assert("YES" == await parseAndEvaluateStatement(`{SimpleAIChat/chat {N "13"}}`), 'Expected response was YES')
    })
  })

  describe('Basic planner', () => {
    test('Simple planner agent', async () => {
      await doInternModule('SPA', `entity Person {id Int @id, name String, age Int}`)
      await doInternModule('SimplePlannerAgent',
        `agent planner01
          {instruction "Based on the user request, create appropriate patterns based on the SPA module.",
           tools "SPA",
           llm "planner01_llm"}
          workflow chat {{planner01 {message chat.msg}}}
          `)
      const k = async (ins: string) => {
        return await parseAndEvaluateStatement(`{SimplePlannerAgent/chat {msg "${ins}"}}`)
      }
      type P = { id: number, name: string, age: number }
      const cr = async (p: P) => {
        return await k(`Create a new Person aged ${p.age} with id ${p.id} and name '${p.name}'. Return only the pattern, no need to return a complete workflow.`)
      }
      const chk = (inst: Instance, p: P) => {
        assert(isInstanceOfType(inst, 'SPA/Person'))
        assert(inst.lookup('id') == p.id && inst.lookup('age') == p.age && inst.lookup('name') == p.name)
      }
      const p1: P = { id: 101, name: 'Joe', age: 23 }
      chk(await cr(p1), p1)
      const p2: P = { id: 102, name: 'Mat', age: 34 }
      chk(await cr(p2), p2)
      let r: Instance[] = await k('Lookup person by id 101')
      assert(r.length == 1)
      chk(r[0], p1)
      const ins = "Generate a workflow for creating new Persons. All attributes must be receieved via the event. "
        .concat("The event should have an extra boolean attribute called X. ")
        .concat("If X is set create the Person with age incremented by one, otherwise use the age as specified in the event. ")
        .concat("(Only define the workflow, no need to define the event).")
      const wfs = await k(ins)
      const wf: WorkflowDefinition = await parseWorkflow(wfs)
      addWorkflowFromDef(wf, 'SPA')
      let p = { id: 103, name: "Chole", age: 11 }
      chk(await parseAndEvaluateStatement(`{SPA/${wf.name} {id 103, name "Chole", age 10, X true}}`), p)
      p = { id: 104, name: "Dew", age: 10 }
      chk(await parseAndEvaluateStatement(`{SPA/${wf.name} {id 104, name "Dew", age 10, X false}}`), p)
      r = await k('Lookup person by id 104')
      assert(r.length == 1)
      chk(r[0], p)
    })
  })
} else {
  describe('Skipping agent tests', () => {
    test('Skipping agent tests', async () => {
    })
  })
}