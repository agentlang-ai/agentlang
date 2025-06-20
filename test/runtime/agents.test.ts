import { assert, describe, test } from "vitest"
import { provider } from "../../src/runtime/agents/registry.js"
import { AgentServiceProvider, AIResponse, humanMessage, systemMessage } from "../../src/runtime/agents/provider.js"
import { doInternModule } from "../util.js"
import { parseAndEvaluateStatement } from "../../src/runtime/interpreter.js"

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
            {simpleChatAgent {message "12"}}
          }
          `)
      await parseAndEvaluateStatement(`{SimpleAIChat/chat {}}`).then((result: any) => {
        assert(result == "NO")
      })
    })
  })

} else {
  describe('Skipping agent tests', () => {
    test('Skipping agent tests', async () => {
    })
  })
}