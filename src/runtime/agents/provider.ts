import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

export interface AgentServiceProvider {
  invoke(messages: BaseMessage[]): any;
}

export function systemMessage(msg: string): SystemMessage {
  return new SystemMessage(msg);
}

export function humanMessage(msg: string): HumanMessage {
  return new HumanMessage(msg);
}

function getContent(aiMsg: AIMessage): string {
  return aiMsg.content.toString();
}

export type AIResponse = {
  content: string;
  sysMsg: AIMessage;
};

export function asAIResponse(aiMsg: AIMessage): AIResponse {
  return {
    content: getContent(aiMsg),
    sysMsg: aiMsg,
  };
}
