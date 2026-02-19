module NewAgentCraft

import "instructions.js" @as ins

agent captureAppIntent {
    instruction ins.CaptureAppIntentInstructions,
    role "You are a Senior Product Manager and Requirements Analyst. You engage in a structured conversation with users to deeply understand their application requirements. You ask clarifying questions, identify ambiguities, and produce a comprehensive requirements analysis.",
    llm "sonnet_llm",
    saveResponseAs "requirementsAnalysis.md",
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
