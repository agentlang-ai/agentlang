import { createAgentlangServices } from '../language/agentlang-module.js';
import { EmptyFileSystem, LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import { Module } from './generated/ast.js';

const services = createAgentlangServices(EmptyFileSystem);
const parse = parseHelper<Module>(services.Agentlang);

export async function parseModule(moduleDef: string): Promise<Module> {
  const document = await parse(moduleDef, { validation: true });
  maybeRaiseParserErrors(document);
  return document.parseResult.value;
}

export async function parseStatement(stmt: string): Promise<Module> {
  return parseModule(`module Temp\nworkflow TempEvent { ${stmt} }`);
}

function maybeRaiseParserErrors(document: LangiumDocument) {
  if (document.parseResult.lexerErrors.length > 0 || document.parseResult.parserErrors.length > 0) {
    const errs: Array<string> = [];
    document.parseResult.lexerErrors.forEach((v: any) => {
      errs.push(v.message);
    });
    document.parseResult.parserErrors.forEach((v: any) => {
      errs.push(v.message);
    });
    throw new Error(`There were parser errors: \n ${errs.join('\n')}`);
  }
}
