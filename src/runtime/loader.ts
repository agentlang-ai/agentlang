import chalk from 'chalk';
import { NodeFileSystem } from 'langium/node';
import { extractAstNode } from '../cli/cli-util.js';
import { createAgentlangServices } from '../language/agentlang-module.js';
import { Module, Def, isEntity/*, isEvent, isRecord, isRelationship, isWorkflow*/ } from '../language/generated/ast.js';
import {addModule, addEntity/*, addEvent, addRecord, addRelationship, addWorkflow*/} from "./module.js";

export const load = async (fileName: string): Promise<void> => {
    const services = createAgentlangServices(NodeFileSystem).Agentlang;
    const model = await extractAstNode<Module>(fileName, services);
    const moduleName = internModule(model);
    console.log(chalk.green(`Module loaded successfully: ${moduleName}`));
};

function internModule(module: Module): string {
    addModule(module.name);
    module.defs.forEach((def: Def) => {
        if (isEntity(def)) {
            addEntity(def.name, def.attributes);
        }
    })
    return module.name;
}