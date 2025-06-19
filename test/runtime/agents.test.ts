import { assert, describe, test } from "vitest"
import { provider } from "../../src/runtime/agents/registry.js"
import { AgentServiceProvider, AIResponse, humanMessage, systemMessage } from "../../src/runtime/agents/provider.js"

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