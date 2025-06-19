import { ChatOpenAI } from '@langchain/openai';
import { AgentServiceProvider, AIResponse, asAIResponse } from '../provider.js';
import { BaseMessage } from '@langchain/core/messages';

export class OpenAIProvider implements AgentServiceProvider {
  private model: ChatOpenAI;

  constructor(config?: Map<string, any>) {
    let modelName = 'gpt-4';
    if (config) {
      modelName = config.get('model') || modelName;
    }
    this.model = new ChatOpenAI({ model: modelName });
  }

  async invoke(messages: BaseMessage[]): Promise<AIResponse> {
    return asAIResponse(await this.model.invoke(messages));
  }
}
