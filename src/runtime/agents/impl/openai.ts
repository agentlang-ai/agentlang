import { ChatOpenAI } from '@langchain/openai';
import { AgentServiceProvider, AIResponse, asAIResponse } from '../provider.js';
import { BaseMessage } from '@langchain/core/messages';

export class OpenAIProvider implements AgentServiceProvider {
  private model: ChatOpenAI;

  constructor(modelName?: string) {
    modelName = modelName ? modelName : 'gpt-4';
    this.model = new ChatOpenAI({ model: modelName });
  }

  async invoke(messages: BaseMessage[]): Promise<AIResponse> {
    return asAIResponse(await this.model.invoke(messages));
  }
}
