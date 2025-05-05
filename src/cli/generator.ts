import { Module, Def } from '../language/generated/ast.js';
import { extractDestinationAndName } from './cli-util.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function generateCommands(module: Module, filePath: string, destination: string | undefined): Object {
    const data = extractDestinationAndName(filePath, destination);
    const generatedFilePath = `${path.join(data.destination, data.name)}.json`;

    if (!fs.existsSync(data.destination)) {
        fs.mkdirSync(data.destination, { recursive: true });
    }

    const result = generateStatements(module.defs);

    fs.writeFileSync(generatedFilePath, JSON.stringify(result, undefined, 2));
    return generatedFilePath;
}

function generateStatements(defs: Def[]): Object[] {
    return defs;
}