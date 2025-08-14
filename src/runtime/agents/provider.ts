import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatPromptValueInterface } from '@langchain/core/prompt_values';
import { ChatPromptTemplate } from '@langchain/core/prompts';

export interface AgentServiceProvider {
  invoke(messages: BaseMessage[], externalToolSpecs: any[] | undefined): any;
}

export function systemMessage(msg: string): SystemMessage {
  return new SystemMessage(msg);
}

export function humanMessage(msg: string): HumanMessage {
  return new HumanMessage(msg);
}

export function assistantMessage(msg: string): AIMessage {
  return new AIMessage(msg);
}

function getContent(aiMsg: AIMessage): string {
  const c: any = aiMsg.content;
  if (c instanceof Object) {
    return JSON.stringify(c);
  }
  return c;
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

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type PromptTemplateEntry = {
  role: MessageRole;
  text: string;
};

function normalizeTemplateEntry(entry: PromptTemplateEntry): string[] {
  return [entry.role, entry.text];
}

export function makePromptTemplate(msgs: PromptTemplateEntry[]): ChatPromptTemplate {
  const input: any = msgs.map(normalizeTemplateEntry);
  return ChatPromptTemplate.fromMessages(input);
}

export async function realizePromptTemplate(
  template: ChatPromptTemplate,
  values: any
): Promise<BaseMessage[]> {
  const pvals: ChatPromptValueInterface = await template.invoke(values);
  return pvals.toChatMessages();
}
