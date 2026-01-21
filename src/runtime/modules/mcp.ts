import { listClientTools } from '../mcpclient.js';
import { makeCoreModuleName } from '../util.js';

export const CoreMcpModuleName = makeCoreModuleName('mcp');

export default `module ${CoreMcpModuleName}

import "./modules/mcp.js" @as mcp

entity Client {
    name String @id,
    version String @default("1.0.0"),
    serverUrl String,
    clientId String @optional,
    clientSecret String @optional,
    bearerToken String @optional
}

@public event listTools {
    clientName String
}

workflow listTools {
    {Client {name? listTools.clientName}} @as [client];
    await mcp.listClientTools_(client)
}

@public event createClient {
    name String @id,
    version String @default("1.0.0"),
    serverUrl String,
    clientId String @optional,
    clientSecret String @optional,
    bearerToken String @optional
}

workflow createClient {
    purge {Client {name? createClient.name}}
    {Client {}, @from createClient} @as client
    {listTools {clientName client.name}}
    client
}
`;

export const listClientTools_ = listClientTools;
