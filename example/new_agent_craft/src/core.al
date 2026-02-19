module NewAgentCraft

import "instructions.js" @as ins

agent captureAppIntent {
    instruction ins.CaptureAppIntentInstructions,
    role "You are a Senior Product Manager and Requirements Analyst. You engage in a structured conversation with users to deeply understand their application requirements. You ask clarifying questions, identify ambiguities, and produce a comprehensive requirements analysis.",
    llm "sonnet_llm",
    saveResponseAs "requirementsAnalysis.md",
    compact 20,
    stateless false
}

@public event captureIntent {
    chatId UUID,
    message String
}

workflow captureIntent {
    {captureAppIntent {message captureIntent.message, chatId captureIntent.chatId}} @as response;
    {"response": response, "file": "requirementsAnalysis.md"}
}

agent identifyCoreObjects {
    instruction ins.IdentifyCoreObjectsInstructions,
    role "You are a Senior Domain Architect who identifies and models the core domain objects, their attributes, and relationships from application requirements.",
    llm "sonnet_llm",
    saveResponseAs "coreObjects.md",
    compact 20,
    stateless false
}

@public event identifyObjects {
    chatId UUID,
    message String
}

workflow identifyObjects {
    {identifyCoreObjects {message identifyObjects.message, chatId identifyObjects.chatId}} @as response;
    {"response": response, "file": "coreObjects.md"}
}

agent generateUISpec {
    instruction ins.GenerateUISpecInstructions,
    role "You are a Senior UX Architect who designs comprehensive UI specifications from application requirements and domain models.",
    llm "sonnet_llm",
    saveResponseAs "uiSpec.md",
    compact 20,
    stateless false
}

@public event generateUI {
    chatId UUID,
    message String
}

workflow generateUI {
    {generateUISpec {message generateUI.message, chatId generateUI.chatId}} @as response;
    {"response": response, "file": "uiSpec.md"}
}

agent generateAPISpec {
    instruction ins.GenerateAPISpecInstructions,
    role "You are a Senior API Architect who designs RESTful API specifications that serve a UI and map to a domain model.",
    llm "sonnet_llm",
    saveResponseAs "apiSpec.md",
    compact 20,
    stateless false
}

@public event generateAPI {
    chatId UUID,
    message String
}

workflow generateAPI {
    {generateAPISpec {message generateAPI.message, chatId generateAPI.chatId}} @as response;
    {"response": response, "file": "apiSpec.md"}
}

agentlang/retry dataModelRetry {
    attempts 50,
    backoff {
        strategy constant,
        delay 5,
        magnitude seconds
    }
}

agent generateDataModel {
    instruction ins.GenerateDataModelInstructions,
    role "You are a Senior Data Architect who translates application requirements, domain objects, and API specifications into precise agentlang data model definitions with entities and relationships.",
    llm "sonnet_llm",
    saveResponseAs "dataModel.al",
    validate agentlang/validateModule,
    retry NewAgentCraft/dataModelRetry,
    compact 20,
    stateless false
}

@public event generateModel {
    chatId UUID,
    message String
}

workflow generateModel {
    {generateDataModel {message generateModel.message, chatId generateModel.chatId}} @as response;
    {"response": response, "file": "dataModel.al"}
}

agent generateWorkflows {
    instruction ins.GenerateWorkflowsInstructions,
    role "You are a Senior Software Architect who translates data models and API specifications into executable agentlang workflows with events.",
    llm "sonnet_llm",
    saveResponseAs "workflows.al",
    validate agentlang/validateModule,
    retry NewAgentCraft/dataModelRetry,
    compact 20,
    stateless false
}

@public event generateWflows {
    chatId UUID,
    message String
}

workflow generateWflows {
    {generateWorkflows {message generateWflows.message, chatId generateWflows.chatId}} @as response;
    {"response": response, "file": "workflows.al"}
}

agent generateAgents {
    instruction ins.GenerateAgentsInstructions,
    role "You are a Senior AI Engineer who designs intelligent agents that interact with a data model and its workflows to serve user queries and automate tasks.",
    llm "sonnet_llm",
    saveResponseAs "agents.al",
    validate agentlang/validateModule,
    retry NewAgentCraft/dataModelRetry,
    compact 20,
    stateless false
}

@public event generateAgentSpecs {
    chatId UUID,
    message String
}

workflow generateAgentSpecs {
    {generateAgents {message generateAgentSpecs.message, chatId generateAgentSpecs.chatId}} @as response;
    {"response": response, "file": "agents.al"}
}

agent assembleFinalApp {
    instruction ins.AssembleFinalAppInstructions,
    role "You are a Senior Software Architect who assembles validated components into a complete, deployable agentlang application with all required configuration files.",
    llm "sonnet_llm",
    saveResponseAs "finalApp.md",
    compact 20,
    stateless false
}

@public event assembleApp {
    chatId UUID,
    message String,
    outputDir String
}

workflow assembleApp {
    {assembleFinalApp {message assembleApp.message, chatId assembleApp.chatId}} @as response;
    {agentlang/writeAppFiles {content response, outputDir assembleApp.outputDir}} @as writeResult;
    {"response": response, "file": "finalApp.md", "outputDir": assembleApp.outputDir, "writtenFiles": writeResult}
}
