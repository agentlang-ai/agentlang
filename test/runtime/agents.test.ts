import { assert, describe, test } from "vitest"
import { provider } from "../../src/runtime/agents/registry.js"
import { AgentServiceProvider, AIResponse, humanMessage, systemMessage } from "../../src/runtime/agents/provider.js"
import { doInternModule } from "../util.js"
import { parseAndEvaluateStatement } from "../../src/runtime/interpreter.js"
import { Instance, isInstanceOfType } from "../../src/runtime/module.js"

if (process.env.AL_TEST) {

  describe('Basic module operations', () => {
    test('check create module', async () => {
      const ai: AgentServiceProvider = new (provider("OpenAI"))()
      await ai.invoke([
        systemMessage("Is the following number odd? Answer YES or NO."),
        humanMessage("11")
      ]).then((result: AIResponse) => {
        assert(result.content == "YES")
      })
    })
  })

  describe('Basic agent', () => {
    test('Simple chat agent', async () => {
      await doInternModule(`module SimpleAIChat
          {agentlang_ai/llm {name "simpleChatLLM"}}
          {agentlang_ai/agent {name "simpleChatAgent",
                              instruction "Is the following number odd? Answer YES or NO.",
                              llm "simpleChatLLM"}}
          workflow chat {
            {simpleChatAgent {message chat.N}}
          }
          `)
      assert("NO" == await parseAndEvaluateStatement(`{SimpleAIChat/chat {N "12"}}`))
      assert("YES" == await parseAndEvaluateStatement(`{SimpleAIChat/chat {N "13"}}`))
    })
  })

  describe('Basic planner', () => {
    test('Simple planner agent', async () => {
      await doInternModule(`module SPA entity Person {id Int @id, name String, age Int}`)
      await doInternModule(`module SimplePlannerAgent
          {agentlang_ai/llm {name "planner01_llm"}}
          {agentlang_ai/agent {name "planner01",
                              instruction "Based on the user request, create appropriate patterns based on the SPA module.",
                              tools ["SPA"],
                              llm "planner01_llm"}}
          workflow chat {
            {planner01 {message chat.msg}}
          }
          `)
      const ins1 = "Create a new Person aged 23 with id 101 and name 'Joe'. Return only the pattern, no need to return a complete workflow."
      const pat1 = await parseAndEvaluateStatement(`{SimplePlannerAgent/chat {msg "${ins1}"}}`)
      const inst: Instance = await parseAndEvaluateStatement(pat1)
      assert(isInstanceOfType(inst, 'SPA/Person'))
      assert(inst.lookup('id') == 101 && inst.lookup('age') == 23 && inst.lookup('name') == 'Joe')
    })
  })

} else {
  describe('Skipping agent tests', () => {
    test('Skipping agent tests', async () => {
    })
  })
}