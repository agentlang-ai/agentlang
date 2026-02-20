module AgentCraft

import "instructions.js" @as ins

agent captureAppIntent {
    instruction ins.CaptueAppIntentInstructions,
    role "You are a Senior Product Manager who is tasked with capturing the core intent and domain of an app from user provided high-level specifications.",
    llm "sonnet_llm",
    saveResponseAs "requirementsAnalysis.md",
    stateless true
}

agent identifyCoreObjectsOfTheApp {
    instruction ins.CoreObjectsIdentificationInstructions,
    role "You are a Senior Product Manager who is tasked with identifying the core objects involved in an app's architecture.",
    llm "sonnet_llm",
    saveResponseAs "dataModelSpec.md",
    stateless true
}

agent generateUISpecFromUserRequest {
    instruction ins.GenerateUISpecInstructions,
    role "You are a Senior Product Manager who is tasked with converting product requirements to UI specifications.",
    llm "sonnet_llm",
    saveResponseAs "uiSpec.md",
    stateless true
}

agent generateAPISpecFromUISpec {
    instruction ins.GenerateApiSpecInstructions,
    role "You are a Senior Software Architect who designs the backend API for a UI specification."
    llm "sonnet_llm",
    saveResponseAs "apiSpec.md",
    stateless true
}

agent generateDataModel {
    instruction ins.GenerateDataModelInstructions,
    role "You are a Senior Software Architect who translates an app requirements spec and associated domain objects to a data-model of entities and relationships."
    llm "sonnet_llm",
    saveResponseAs "dataModel.md",
    stateless true
}

agent generateWorkflowsFromDataModelAndApiSpec {
    instruction ins.GenerateWorklowInstructions,
    role "You are a Senior Software Architect who translates a high-level data-model and REST API spec to executable workflows."
    llm "sonnet_llm",
    saveResponseAs "workflows.md",
    stateless true
}

agent generateAgentsFromDataModelAndWorkflows {
    instruction ins.GenerateAgentsInstructions,
    role "You are a Senior AI Engineer who creates agents that can handle queries based on a given data model and workflows."
    llm "sonnet_llm",
    saveResponseAs "agents.md",
    stateless true
}

agent assembleFinalApp {
    instruction ins.AssembleAppInstructions,
    role "You are a Senior Software Architect who assembles a data-model with associated workflows and agents into a final application."
    llm "sonnet_llm",
    saveResponseAs "app.al",
    stateless true
}

@public workflow requirementsAnalysis {
    {captureAppIntent {message requirementsAnalysis.message, chatId requirementsAnalysis.chatId}} @as response;
    {"response": response, "file": "requirementsAnalysis.md"}
}

@public workflow dataModelSpec {
    {identifyCoreObjectsOfTheApp {message dataModelSpec.message, chatId dataModelSpec.chatId}} @as response;
    {"response": response, "file": "dataModelSpec.md"}
}

@public workflow uiSpec {
    {generateUISpecFromUserRequest {message uiSpec.message, chatId uiSpec.chatId}} @as response;
    {"response": response, "file": "uiSpec.md"}
}

@public workflow apiSpec {
    {generateAPISpecFromUISpec {message apiSpec.message, chatId apiSpec.chatId}} @as response;
    {"response": response, "file": "apiSpec.md"}
}

@public workflow dataModel {
    {generateDataModel {message dataModel.message, chatId dataModel.chatId}} @as response;
    {"response": response, "file": "dataModel.md"}
}

@public workflow workflows {
    {generateWorkflowsFromDataModelAndApiSpec {message workflows.message, chatId workflows.chatId}} @as response;
    {"response": response, "file": "workflows.md"}
}

@public workflow agents {
    {generateAgentsFromDataModelAndWorkflows {message agents.message, chatId agents.chatId}} @as response;
    {"response": response, "file": "agents.md"}
}

@public workflow app {
    {assembleFinalApp {message app.message, chatId app.chatId}} @as response;
    {"response": response, "file": "app.al"}
}
