module AgentCraft

import "instructions.js" @as ins

record UserRequest {
    moduleName String @optional,
    dataModelRequest String,
    workflowRequest String,
    agentRequest String
}

record Generated {
    code String
}

record DistilledRequest {
    distilledRequest String
}

record MetadataDoc {
    content String
}

record MetadataGeneratorInput {
    moduleName String,
    dataModelRequest String,
    workflowRequest String,
    agentRequest String,
    generatedCode String
}

record ComponentRequest {
    userMessage String,
    componentName String,
    moduleName String,
    metadataContext String @optional
}

record ComponentResponse {
    definition String,
    analysis String
}

// Structured attribute definition for entities/records/events
record AttributeDefinition {
    name String,
    type String,
    properties String @optional
}

record EntityComponentResponse {
    componentType String,
    componentName String,
    attributes String,
    meta String @optional,
    analysis String
}

record RelationshipComponentResponse {
    componentName String,
    relationshipType String,
    fromEntity String,
    toEntity String,
    cardinality String @optional,
    analysis String
}

record RequestAnalysisResponse {
    actions String,
    analysis String
}

record ComponentUpdateRequest {
    currentDefinition String,
    userMessage String,
    moduleName String,
    metadataContext String @optional
}

agentlang/retry classifyRetry {
    attempts 3,
    backoff {
	    strategy linear,
	    delay 2,
	    magnitude seconds,
	    factor 2
    }
}

agent requirementDistiller {
  instruction ins.REQUIREMENT_DISTILLER_INSTRUCTION,
  llm "sonnet_llm",
  responseSchema UserRequest
}

agent dataModelCreator {
  instruction ins.DATAMODEL_CREATOR_INSTRUCTION,
  llm "sonnet_llm",
  validate agentlang/validateModule,
  retry AgentCraft/classifyRetry,
  responseSchema AgentCraft/Generated
}

agent workflowDistiller {
  instruction ins.WORKFLOW_DISTILLER_INSTRUCTION,
  llm "sonnet_llm",
  responseSchema AgentCraft/DistilledRequest
}

agent workflowCreator {
  instruction ins.WORKFLOW_CREATOR_INSTRUCTION,
  llm "sonnet_llm",
  validate agentlang/validateModule,
  retry AgentCraft/classifyRetry,
  responseSchema AgentCraft/Generated
}

agent agentDistiller {
  instruction ins.AGENT_DISTILLER_INSTRUCTION,
  llm "sonnet_llm",
  responseSchema AgentCraft/DistilledRequest
}

agent agentCreator {
  instruction ins.AGENT_CREATOR_INSTRUCTION,
  llm "sonnet_llm",
  validate agentlang/validateModule,
  retry AgentCraft/classifyRetry,
  responseSchema AgentCraft/Generated
}

event GenerateMetadata {
    message String
}

agent metadataGenerator {
  instruction ins.METADATA_GENERATOR_INSTRUCTION,
  llm "sonnet_llm",
  responseSchema AgentCraft/MetadataDoc
}

agent entityComponentGenerator {
  instruction ins.ENTITY_COMPONENT_GENERATOR_INSTRUCTION,
  llm "sonnet_llm",
  responseSchema AgentCraft/EntityComponentResponse
}

agent agentComponentGenerator {
  instruction ins.AGENT_COMPONENT_GENERATOR_INSTRUCTION,
  llm "sonnet_llm",
  validate agentlang/validateModule,
  retry AgentCraft/classifyRetry,
  responseSchema AgentCraft/ComponentResponse
}

agent eventComponentGenerator {
  instruction ins.EVENT_COMPONENT_GENERATOR_INSTRUCTION,
  llm "sonnet_llm",
  validate agentlang/validateModule,
  retry AgentCraft/classifyRetry,
  responseSchema AgentCraft/ComponentResponse
}

agent workflowComponentGenerator {
  instruction ins.WORKFLOW_COMPONENT_GENERATOR_INSTRUCTION,
  llm "sonnet_llm",
  validate agentlang/validateModule,
  retry AgentCraft/classifyRetry,
  responseSchema AgentCraft/ComponentResponse
}

agent relationshipComponentGenerator {
  instruction ins.RELATIONSHIP_COMPONENT_GENERATOR_INSTRUCTION,
  llm "sonnet_llm",
  responseSchema AgentCraft/RelationshipComponentResponse
}

agent requestAnalyzer {
  instruction ins.REQUEST_ANALYZER_INSTRUCTION,
  llm "sonnet_llm",
  responseSchema AgentCraft/RequestAnalysisResponse
}

agent entityComponentUpdater {
  instruction ins.ENTITY_COMPONENT_UPDATER_INSTRUCTION,
  llm "sonnet_llm",
  responseSchema AgentCraft/EntityComponentResponse
}

agent agentComponentUpdater {
  instruction ins.AGENT_COMPONENT_UPDATER_INSTRUCTION,
  llm "sonnet_llm",
  validate agentlang/validateModule,
  retry AgentCraft/classifyRetry,
  responseSchema AgentCraft/ComponentResponse
}

agent workflowComponentUpdater {
  instruction ins.WORKFLOW_COMPONENT_UPDATER_INSTRUCTION,
  llm "sonnet_llm",
  validate agentlang/validateModule,
  retry AgentCraft/classifyRetry,
  responseSchema AgentCraft/ComponentResponse
}

agent eventComponentUpdater {
  instruction ins.EVENT_COMPONENT_UPDATER_INSTRUCTION,
  llm "sonnet_llm",
  validate agentlang/validateModule,
  retry AgentCraft/classifyRetry,
  responseSchema AgentCraft/ComponentResponse
}

agent relationshipComponentUpdater {
  instruction ins.RELATIONSHIP_COMPONENT_UPDATER_INSTRUCTION,
  llm "sonnet_llm",
  responseSchema AgentCraft/RelationshipComponentResponse
}

workflow GenerateMetadata {
    {metadataGenerator {message GenerateMetadata.message}}
}

flow builderAgent {
  requirementDistiller --> dataModelCreator
  dataModelCreator --> workflowDistiller
  workflowDistiller --> workflowCreator
  workflowCreator --> agentDistiller
  agentDistiller --> agentCreator
}

@public agent builderAgent {
  llm "haiku_llm",
  role "You are a language builder which generates Agentlang based code."
}

@public event generateAgentlang {
  requirements String
}

workflow generateAgentlang {
  {builderAgent {message generateAgentlang.requirements}}
}

agent requirementDistillerResolver {
  instruction ins.REQUIREMENT_DISTILLER_INSTRUCTION_RESOLVER,
  llm "sonnet_llm",
  validate agentlang/validateModule,
  retry AgentCraft/classifyRetry
}

agent dataModelCreatorResolver {
  instruction ins.DATAMODEL_CREATOR_INSTRUCTION_RESOLVER,
  llm "sonnet_llm",
  validate agentlang/validateModule,
  retry AgentCraft/classifyRetry
}

agent workflowDistillerResolver {
  instruction ins.WORKFLOW_DISTILLER_INSTRUCTION_RESOLVER,
  llm "sonnet_llm",
  responseSchema AgentCraft/DistilledRequest
}

agent workflowCreatorResolver {
  instruction ins.WORKFLOW_CREATOR_INSTRUCTION_RESOLVER,
  llm "sonnet_llm",
  validate agentlang/validateModule,
  retry AgentCraft/classifyRetry
}

agent agentDistillerResolver {
  instruction ins.AGENT_DISTILLER_INSTRUCTION_RESOLVER,
  llm "sonnet_llm",
  responseSchema AgentCraft/DistilledRequest
}

agent agentCreatorResolver {
  instruction ins.AGENT_CREATOR_INSTRUCTION_RESOLVER,
  llm "sonnet_llm",
  validate agentlang/validateModule,
  retry AgentCraft/classifyRetry
}

agent metadataGeneratorResolver {
  instruction ins.METADATA_GENERATOR_INSTRUCTION,
  llm "sonnet_llm",
  responseSchema AgentCraft/MetadataDoc
}

workflow metadataGeneratorResolver {
    {metadataGeneratorResolver {
        moduleName: GenerateMetadata.moduleName,
        dataModelRequest: GenerateMetadata.dataModelRequest,
        workflowRequest: GenerateMetadata.workflowRequest,
        agentRequest: GenerateMetadata.agentRequest,
        generatedCode: GenerateMetadata.generatedCode
    }}
}

flow builderAgentResolver {
  requirementDistillerResolver --> dataModelCreatorResolver
  dataModelCreatorResolver --> workflowDistillerResolver
  workflowDistillerResolver --> workflowCreatorResolver
  workflowCreatorResolver --> agentDistillerResolver
  agentDistillerResolver --> agentCreatorResolver
}

agent builderAgentResolver {
  llm "haiku_llm",
  role "You are a language builder which generates Agentlang based code with resolver awareness."
}

@public event generateAgentlangResolver {
  requirements String
}

workflow generateAgentlangResolver {
  {builderAgentResolver {message generateAgentlangResolver.requirements}}
}

@public event generateEntityComponent {
  message String
}

workflow generateEntityComponent {
  {entityComponentGenerator {message: generateEntityComponent.message}}
}

@public event generateAgentComponent {
  message String
}

workflow generateAgentComponent {
  {agentComponentGenerator {message: generateAgentComponent.message}}
}

@public event generateEventComponent {
  message String
}

workflow generateEventComponent {
  {eventComponentGenerator {message: generateEventComponent.message}}
}

@public event generateWorkflowComponent {
  message String
}

workflow generateWorkflowComponent {
  {workflowComponentGenerator {message: generateWorkflowComponent.message}}
}

@public event generateRelationshipComponent {
  message String
}

workflow generateRelationshipComponent {
  {relationshipComponentGenerator {message: generateRelationshipComponent.message}}
}

@public event analyzeRequest {
  message String
}

workflow analyzeRequest {
  {requestAnalyzer {message: analyzeRequest.message}}
}

// ==================== COMPONENT UPDATE EVENTS/WORKFLOWS ====================

@public event updateEntityComponent {
  message String
}

workflow updateEntityComponent {
  {entityComponentUpdater {message: updateEntityComponent.message}}
}

@public event updateAgentComponent {
  message String
}

workflow updateAgentComponent {
  {agentComponentUpdater {message: updateAgentComponent.message}}
}

@public event updateWorkflowComponent {
  message String
}

workflow updateWorkflowComponent {
  {workflowComponentUpdater {message: updateWorkflowComponent.message}}
}

@public event updateEventComponent {
  message String
}

workflow updateEventComponent {
  {eventComponentUpdater {message: updateEventComponent.message}}
}

@public event updateRelationshipComponent {
  message String
}

workflow updateRelationshipComponent {
  {relationshipComponentUpdater {message: updateRelationshipComponent.message}}
}

// ==================== ORCHESTRATOR ====================

record ProcessedAction {
    type String,
    componentType String,
    componentName String,
    attributes String @optional,
    meta String @optional,
    analysis String,
    relationshipType String @optional,
    fromEntity String @optional,
    toEntity String @optional,
    cardinality String @optional
}

record OrchestratorResponse {
    processedActions String,
    overallAnalysis String
}

@public agent componentOrchestrator {
    role "Orchestrate multiple component creation and update operations based on user request",
    instruction "{{message}}

YOU MUST RETURN STRUCTURED DATA, NOT RAW CODE.

PROCESS:
1. Parse message JSON to get: userMessage, moduleName, metadataContext
2. Call analyzeRequest to determine what actions are needed
3. For each action, call the appropriate generator to get STRUCTURED component data
4. Return the structured data in processedActions

FOR ENTITIES/RECORDS:
The generator returns structured fields: componentType, componentName, attributes (JSON string), meta (JSON string), analysis.
Pass these directly to processedActions array.

FOR RELATIONSHIPS:
The generator returns: componentName, relationshipType, fromEntity, toEntity, cardinality, analysis.
Pass these directly to processedActions array.

RULES:
- Return STRUCTURED DATA from generators, not raw Agentlang code
- attributes field is a JSON string array
- meta field is a JSON string object
- NO raw Agentlang syntax in the response
- The system will use these structured fields to build the component",
    tools [
        AgentCraft/analyzeRequest,
        AgentCraft/generateEntityComponent,
        AgentCraft/generateAgentComponent,
        AgentCraft/generateEventComponent,
        AgentCraft/generateWorkflowComponent,
        AgentCraft/generateRelationshipComponent,
        AgentCraft/updateEntityComponent,
        AgentCraft/updateAgentComponent,
        AgentCraft/updateEventComponent,
        AgentCraft/updateWorkflowComponent,
        AgentCraft/updateRelationshipComponent
    ],
    type "planner",
    llm "sonnet_llm",
    responseSchema AgentCraft/OrchestratorResponse
}
