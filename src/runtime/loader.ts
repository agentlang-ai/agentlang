import chalk from 'chalk';
import path from 'node:path';
import * as fs from 'fs';
import { NodeFileSystem } from 'langium/node';
import { extractAstNode } from '../cli/cli-util.js';
import { createAgentlangServices } from '../language/agentlang-module.js';
import { Module, Def, isEntity, isEvent, isRecord, isWorkflow, Import } from '../language/generated/ast.js';
import { addModule, addEntity, addEvent, addRecord, addWorkflow } from "./module.js";
import { importModule, runShellCommand } from './util.js';

export type ApplicationSpec = {
    name: string,
    version: string,
    dependencies?: object | undefined
}

const loadApp = async (appJsonFile: string, continuation: Function): Promise<void> => {
    const s: string = fs.readFileSync(appJsonFile, "utf-8")
    const appSpec: ApplicationSpec = JSON.parse(s)
    let cont2: Function = () => {
        let dir: string = path.dirname(appJsonFile)
        let alFiles: Array<string> = new Array<string>()
        fs.readdir(dir, (err, files) => {
            console.log(err)
            files.forEach((file) => {
                if (path.extname(file) == ".al") {
                    alFiles.push(dir + path.sep + file)
                }
            });
            if (alFiles.length > 0) {
                let loadedCount: number = 0
                let cont: Function = (_: string) => {
                    ++loadedCount
                    if (loadedCount >= alFiles.length) {
                        continuation(appSpec)
                    }
                }
                alFiles.forEach((fileName: string) => {
                    loadModule(fileName, cont)
                })
            }
        })
    }
    if (appSpec.dependencies != undefined) {
        for (const [depName, depVer] of Object.entries(appSpec.dependencies)) {
            runShellCommand(`npm install ${depName}@${depVer}`, cont2)
        }
    } else {
        cont2()
    }
}

export const load = async (fileName: string, continuation: Function): Promise<void> => {
    if (path.basename(fileName) == "app.json") {
        loadApp(fileName, continuation)
    } else {
        loadModule(fileName, (moduleName: string) => {
            continuation({
                name: moduleName,
                version: "0.0.1"
            })
        })
    }
}

const loadModule = async (fileName: string, continuation: Function): Promise<void> => {
    const services = createAgentlangServices(NodeFileSystem).Agentlang;
    const model = await extractAstNode<Module>(fileName, services);
    const moduleName = internModule(model);
    console.log(chalk.green(`Module ${chalk.bold(moduleName)} loaded`));
    if (continuation != undefined) continuation(moduleName)
}

function internModule(module: Module): string {
    addModule(module.name);
    module.imports.forEach((imp: Import) => {
        importModule(imp.path, imp.name);
    })
    module.defs.forEach((def: Def) => {
        if (isEntity(def)) addEntity(def.name, def.attributes)
        else if (isEvent(def)) addEvent(def.name, def.attributes)
        else if (isRecord(def)) addRecord(def.name, def.attributes)
        else if (isWorkflow(def)) addWorkflow(def.name, def.statements)
    })
    return module.name;
}