import { makeCoreModuleName } from "../util.js";

export const CoreMcpModuleName = makeCoreModuleName('mcp');

export default `module ${CoreMcpModuleName}

import "./mcpclient.js" @as mcp

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
    await mcp.listClientTools(client)
}
`