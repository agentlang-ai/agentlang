// Browser-compatible entry point for agentlang
// This module provides browser-safe exports without Node.js-specific dependencies

// ===============================
// Runtime Module Exports
// ===============================

// Types
export type {
  AttributeSpec,
  RecordSchema,
  TriggerInfo,
  RelationshipNode,
  FlowGraphNode,
  ModuleDocument,
  ModuleImportEntry,
  RetryBackoff,
  PrePostTag,
  PrePostOpr,
  ThinWfHeader,
} from './runtime/module.js';

// Classes
export {
  ModuleEntry,
  Record,
  RbacSpecification,
  Agent,
  Entity,
  Event,
  Relationship,
  Workflow,
  Flow,
  Scenario,
  Directive,
  GlossaryEntry,
  DocumentEntry,
  Retry,
  AgentEvaluator,
  Decision,
  Module,
} from './runtime/module.js';

// Constants
export { PlaceholderRecordEntry, builtInTypes, propertyNames } from './runtime/module.js';

// Enum types (exported as const)
export { RbacPermissionFlag, RecordType } from './runtime/module.js';

// Functions
export {
  // Module operations
  fetchModule,
  fetchModuleEntry,
  getModuleNames,
  getUserModuleNames,
  isModule,
  addModule,
  removeModule,
  allModuleNames,
  getActiveModuleName,

  // Entity operations
  getEntity,
  getRelationship,
  getEvent,
  getRecord,
  isEntity,
  isRelationship,
  isEvent,
  isRecord,
  isAgent,
  getEntityRbacRules,

  // Type checking
  isEmptyWorkflow,
  isTopicReference,
  isBuiltInType,
  isValidType,

  // Attribute operations
  newRecordSchema,
  newMeta,
  enumAttributeSpec,
  oneOfAttributeSpec,
  defaultAttributes,
  passwordAttributes,
  objectAttributes,
  isIdAttribute,
  asIdAttribute,
  isUniqueAttribute,
  asUniqueAttribute,
  isIndexedAttribute,
  asIndexedAttribute,
  isOptionalAttribute,
  asOptionalAttribute,
  isArrayAttribute,
  isObjectAttribute,
  isNumericAttribute,
  getAttributeExpr,
  getEnumValues,
  getOneOfRef,
  getAttributeDefaultValue,
  setDefaultAttributeValue,
  getAttributeLength,
  getFkSpec,
  getRefSpec,

  // Record operations
  addEntity,
  addEvent,
  addMcpEvent,
  addRecord,
  addRelationship,
  addBetweenRelationship,
  addContainsRelationship,
  addAgent,

  // Workflow operations
  addWorkflow,
  addAfterCreateWorkflow,
  addAfterUpdateWorkflow,
  addAfterDeleteWorkflow,
  addBeforeCreateWorkflow,
  addBeforeUpdateWorkflow,
  addBeforeDeleteWorkflow,
  prePostWorkflowName,
  untangleWorkflowName,
  parsePrePostWorkflowName,
  getWorkflow,
  flowGraphNext,

  // Document operations
  registerDocumentAlias,
  resolveDocumentAliases,
  registerTopic,
  getTopicDocuments,
  resolveTopicNames,
  getTopicContainerTags,
  getAllDocumentsForTopics,

  // Retry operations
  addGlobalRetry,
  getGlobalRetry,

  // Instance checking
  isEventInstance,
  isEntityInstance,
  isRecordInstance,
  isAgentEvent,
  isAgentEventInstance,

  // Misc
  makeInstance,
} from './runtime/module.js';

// ===============================
// Runtime Loader Exports
// ===============================
export {
  flushAllAndLoad,
  loadAppConfig,
  parseAndIntern,
  runStandaloneStatements,
} from './runtime/loader.js';

// ===============================
// Runtime Utilities Exports
// ===============================
export { isFqName, nameToPath } from './runtime/util.js';

// ===============================
// Runtime Graph Exports
// ===============================
export { buildGraph } from './runtime/relgraph.js';

// ===============================
// Language Syntax Exports
// ===============================
export type {
  MapKey,
  AttributePattern,
  JoinPattern,
  WhereSpecClausePattern,
} from './language/syntax.js';

export {
  BasePattern,
  EmptyBasePattern,
  LiteralPattern,
  FunctionCallPattern,
  ExpressionPattern,
  GroupExpressionPattern,
  NegExpressionPattern,
  NotExpressionPattern,
  ReferencePattern,
  CrudPattern,
  ForEachPattern,
  IfPattern,
  CasePattern,
  DeletePattern,
  ReturnPattern,
  FullTextSearchPattern,
  FlowStepPattern,
} from './language/syntax.js';

export {
  isLiteralPattern,
  isReferenceLiteral,
  referenceParts,
  isStringLiteral,
  isNumberLiteral,
  isBooleanLiteral,
  isIdentifierLiteral,
  isArrayLiteral,
  isMapLiteral,
  isFunctionCallPattern,
  isExpressionPattern,
  isGroupExpressionPattern,
  isNegExpressionPattern,
  isNotExpressionPattern,
  isReferencePattern,
  isCrudPattern,
  isCreatePattern,
  isQueryPattern,
  isQueryUpdatePattern,
  isForEachPattern,
  isIfPattern,
  isCasePattern,
  isDeletePattern,
  newCreatePattern,
  newQueryPattern,
  newQueryUpdatePattern,
  newDeletePattern,
} from './language/syntax.js';

// ===============================
// Language Parser Exports
// ===============================
export type { ExtractedQueryOptions } from './language/parser.js';

export {
  parseHelper,
  parse,
  maybeGetValidationErrors,
  maybeRaiseParserErrors,
  extractQueryOptions,
  introspect,
  introspectCase,
  canParse,
  objectToQueryPattern,
} from './language/parser.js';

// ===============================
// Agents Common Exports
// ===============================
export type {
  AgentCondition,
  AgentScenario,
  AgentGlossaryEntry,
  AgentSummary,
} from './runtime/agents/common.js';

export {
  PlannerDataModelInstructions,
  PlannerWorkflowInstructions,
  PlannerInstructions,
  FlowExecInstructions,
  DecisionAgentInstructions,
  EvalInstructions,
  LearningAgentInstructions,
  newAgentDirective,
  newAgentDirectiveFromIf,
  registerAgentDirectives,
  getAgentDirectives,
  getAgentDirectivesInternal,
  getAgentDirectivesJson,
  removeAgentDirectives,
  addAgentDirective,
  newAgentScenario,
  newAgentScenarioFromIf,
  registerAgentScenarios,
  getAgentScenarios,
  getAgentScenariosJson,
  getAgentScenariosInternal,
  removeAgentScenarios,
  addAgentScenario,
  newAgentGlossaryEntry,
  registerAgentGlossary,
  getAgentGlossary,
  getAgentGlossaryInternal,
  getAgentGlossaryJson,
  removeAgentGlossary,
  addAgentGlossaryEntry,
  registerAgentResponseSchema,
  getAgentResponseSchema,
  removeAgentResponseSchema,
  registerAgentScratchNames,
  getAgentScratchNames,
  removeAgentScratchNames,
} from './runtime/agents/common.js';

// ===============================
// Runtime Definitions Exports
// ===============================
export type {
  UnautInfo,
  FileReader,
  DependencyProvider,
  ModuleLoaderConfig,
  FkSpec,
} from './runtime/defs.js';

export {
  PathAttributeName,
  PathAttributeNameQuery,
  ParentAttributeName,
  DeletedFlagAttributeName,
  AgentIdAttributeName,
  TenantAttributeName,
  isPathAttribute,
  UnauthorisedError,
  BadRequestError,
  UserNotFoundError,
  UserNotConfirmedError,
  PasswordResetRequiredError,
  TooManyRequestsError,
  InvalidParameterError,
  ExpiredCodeError,
  CodeMismatchError,
  setModuleFnFetcher,
  setSubscriptionFn,
  setModuleLoader,
  getModuleLoader,
  ForceReadPermFlag,
  FlowSuspensionTag,
  ExecGraphNode,
  ExecGraph,
  ExecGraphWalker,
  setRuntimeMode_dev,
  setRuntimeMode_prod,
  setRuntimeMode_test,
  setRuntimeMode_init_schema,
  setRuntimeMode_migration,
  setRuntimeMode_undo_migration,
  setRuntimeMode_generate_migration,
  isRuntimeMode_dev,
  isRuntimeMode_prod,
  isRuntimeMode_test,
  isRuntimeMode_init_schema,
  isRuntimeMode_migration,
  isRuntimeMode_generate_migration,
  isRuntimeMode_undo_migration,
  setEventEndpointsUpdater,
  setEntityEndpointsUpdater,
  setRelationshipEndpointsUpdater,
  updateEndpoints,
  setInternDynamicModuleFn,
  DefaultTenantId,
  set_getUserTenantId,
} from './runtime/defs.js';

// ===============================
// JS Modules Exports
// ===============================
export {
  moduleImported,
  getImportedModule,
  getImportedModuleNames,
  getModuleDef,
  getModuleFn,
} from './runtime/jsmodules.js';

// ===============================
// Auth Definitions Exports
// ===============================
export type { ActiveSessionInfo } from './runtime/auth/defs.js';

export {
  AdminUserId,
  isAuthEnabled,
  isRbacEnabled,
  AdminSession,
  BypassSession,
  NoSession,
  isNoSession,
  setLocalEnv,
  getLocalEnv,
} from './runtime/auth/defs.js';

// Note: Features requiring Node.js modules (fs, LanceDB, child_process, etc.) are not available in browser
// Use environment detection to conditionally load these features
