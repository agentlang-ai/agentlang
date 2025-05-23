import { createAgentlangServices } from '../language/agentlang-module.js';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { Module } from './generated/ast.js';

const services = createAgentlangServices(EmptyFileSystem);
export const parse = parseHelper<Module>(services.Agentlang);
