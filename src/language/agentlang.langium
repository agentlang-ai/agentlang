grammar Agentlang

entry ModuleDefinition: 'module' name=QualifiedName (imports+=Import)* (defs+=Definition)*;

Import: 'import' path=STRING '@as' name=ID;

Definition: SchemaDefinition | RelationshipDefinition | WorkflowDefinition | StandaloneStatement 
| AgentDefinition | ResolverDefinition | FlowStepDefinition | FlowDefinition;

StandaloneStatement: stmt=Statement;

SchemaDefinition: EntityDefinition | EventDefinition | RecordDefinition;

PropertyDefinition: (name=TaggedId '(' value=KvPairs ')') | name=TaggedId;

KvPair: value=Literal | key=ID ':' value=Literal;
KvPairs: pairs+=KvPair | pairs+=KvPair ',' pairs+=KvPair;

RecordSchemaDefinition: '{''}' | '{' (attributes+=AttributeDefinition (',' attributes+=AttributeDefinition)*)+
(',' extras+=RecordExtraDefinition (',' extras+=RecordExtraDefinition)*)? '}';

RecordExtraDefinition: rbacSpec=RbacSpecDefinition | meta=MetaDefinition | prePost=PrePostTriggerDefinition 
| uq=CompositeUniqueDefinition | actions=EntityActionsDefinitions;

fragment RecDef: name=QualifiedName extends=ExtendsClause? schema=RecordSchemaDefinition;

EntityDefinition: 'entity' RecDef;
EventDefinition: 'event' RecDef;
RecordDefinition: 'record' RecDef;

ExtendsClause: 'extends' parentName=QualifiedName;

RelationshipDefinition: 'relationship' name=QualifiedName type=('contains' | 'between') nodes=RelNodes properties+=PropertyDefinition*
(schema=RecordSchemaDefinition)?;

NodeDefinition: name=QualifiedName | name=QualifiedName '@as' alias=ID;

RelNodes: '(' node1=NodeDefinition ',' node2=NodeDefinition ')';

AttributeDefinition: name=ID (type=QualifiedName | arrayType=QualifiedName '['']' | oneOfSpec=OneOfSpec | enumSpec=EnumSpec 
| refSpec=RefSpec) ('@expr' '(' expr=Expr ')')? properties+=PropertyDefinition*;

EnumSpec: '@enum' '(' values+=STRING (',' values+=STRING)* ')';

OneOfSpec: '@oneof' '(' ref=Ref ')';

RefSpec: '@ref' '(' ref=ID ')';

RbacSpecDefinition: '@rbac' '[' (specEntries+=RbacSpecEntries (',' specEntries+=RbacSpecEntries)*)+ ']';

RbacSpecEntry: role=RbacRolesSpec | allow=RbacAllowSpec | expr=RbacExpressionSpec;

RbacSpecEntries: '(' (entries+=RbacSpecEntry (',' entries+=RbacSpecEntry)*)+ ')';

RbacRolesSpec: 'roles' ':' '[' (roles+=(ID | '*') (',' roles+=(ID | '*'))*)+ ']';

RbacAllowSpec: 'allow' ':' '[' (oprs+=RbacOpr (',' oprs+=RbacOpr)*)+ ']';

RbacOpr: value=('create' | 'delete' | 'update' | 'read');

RbacExpressionSpec: 'where' ':' lhs=Ref '=' rhs=Ref;

MetaDefinition: '@meta' spec=MapLiteral;

PrePostTriggerDefinition: after=AfterTriggerDefinition | before=BeforeTriggerDefinition;

AfterTriggerDefinition: '@after' triggers=TriggerDefinition;
BeforeTriggerDefinition: '@before' triggers=TriggerDefinition;

TriggerDefinition: '{' entries+=TriggerEntry (',' entries+=TriggerEntry)* '}';
TriggerEntry: on=('create' | 'delete' | 'update') event=ID async='@async'?;

CompositeUniqueDefinition: '@with_unique' '(' attrs+=ID (',' attrs+=ID)* ')';

EntityActionsDefinitions: '@actions' (entries+=ActionEntry (',' entries+=ActionEntry)*)+;

ActionEntry: name=ID event=ID;

ArrayLiteral: '[' ']' | '[' vals+=Statement (',' vals+=Statement)* ']';

MapLiteral: '{' entries+=MapEntry (',' entries+=MapEntry)* '}';

MapEntry: key=MapKey ':' value=Expr;

MapKey: str=STRING | num=Decimal | bool=Boolean;

FnCall: name=(ID | Ref) (('(' ')') | ('(' (args+=Expr (',' args+=Expr)*)+ ')'));

AsyncFnCall: 'await' fnCall=FnCall;

Literal: (id=ID | num=Decimal | str=STRING | ref=Ref | bool=Boolean | fnCall=FnCall | asyncFnCall=AsyncFnCall | array=ArrayLiteral | map=MapLiteral);

fragment Body: '{' '}' | '{' (statements+=Statement (';' statements+=Statement)*)+ '}' | '{' statements+=Statement ';'+ '}' | statements+=Statement;

WorkflowDefinition: 'workflow' (name=ID | header=WorkflowHeader) Body;

WorkflowHeader: tag=WorkflowHeaderTag prefix=WorkflowHeaderPrefix ':' name=QualifiedName;

WorkflowHeaderTag returns string: '@after' | '@before';

WorkflowHeaderPrefix returns string: 'create' | 'update' | 'delete';

Pattern: expr=Expr | crudMap=CrudMap | if=If | forEach=ForEach | delete=Delete | purge=Purge | fullTextSearch=FullTextSearch | return=Return;

Statement: pattern=Pattern hints+=RuntimeHint*;

RuntimeHint: aliasSpec=AliasSpec | catchSpec=CatchSpec | thenSpec=ThenSpec;

AliasSpec: ('@as' (alias=ID | '[' ( aliases+=ID (',' aliases+=ID)*)+ ']'));

ThenSpec: '@then' '{' (statements+=Statement (';' statements+=Statement)*)+ '}';

CrudMap: '{' (name=QueryId '{''}' 
             | (name=QualifiedName '{''}' ',' '@from' source=Literal (',' upsert+='@upsert')?)
             | name=QualifiedName body=CrudMapBody)
             (',' relationships+=RelationshipPattern (',' relationships+=RelationshipPattern)*)?
             (',' into=SelectIntoSpec)? 
             (',' upsert+='@upsert')?
             (',' distinct+='@distinct')?
             '}';

CrudMapBody: '{' (attributes+=SetAttribute (',' attributes+=SetAttribute)*)+ properties+=PropertyDefinition* '}';

SelectIntoSpec: '@into' '{' entries+=SelectIntoEntry (',' entries+=SelectIntoEntry)* '}';

SelectIntoEntry: alias=ID attribute=Ref;

FullTextSearch: '{' name=QueryId query=Literal options=MapLiteral? '}';

Return: 'return' pat=Pattern;

AgentDefinition: 'agent' name=GenericName (body=GenericDefBody? | '{''}');

GenericDefBody: '{' (attributes+=GenericPropertyDef (',' attributes+=GenericPropertyDef)*)+ '}';

GenericPropertyDef: name=ID value=Literal;

FlowStepDefinition: 'flowstep' name=GenericName (body=GenericDefBody? | '{''}');

FlowDefinition: 'flow' name=GenericName (body=FlowDefBody? | '{''}');

FlowDefBody: '{' paths+=FlowPath (';' paths+=FlowPath)* '}';

FlowPath: step=(GenericName | ConditionalFlowStep) ('-->' rest=FlowPath)?;

ConditionalFlowStep: '[' 'if' cond=STRING 'then' then=GenericName 'else' else=GenericName ']';

ResolverDefinition: 'resolver' name=GenericName '[' (paths+=GenericName (',' paths+=GenericName)*)+ ']'
'{' (methods+=ResolverMethodSpec (',' methods+=ResolverMethodSpec)*)+ '}';

ResolverMethodSpec: key=ResolverMethodName fn=ResolverFnName;

ResolverFnName: name=(ID | Ref | STRING);

ResolverMethodName: name=('create' | 'update' | 'upsert' | 'delete' | 'query' | 'subscribe' | 'onSubscription');

RelationshipPattern: name=QualifiedName pattern=Pattern;

CatchSpec: '@catch' '{' (handlers+=Handler)+ '}';

Handler: except=('not_found' | 'error') stmt=Statement;

If: 'if' '(' cond=Expr ')' Body else=Else?;

Else: 'else' Body;

ForEach: 'for' var=ID 'in' src=Pattern Body;

Delete: 'delete' pattern=Pattern;

Purge: 'purge' pattern=Pattern;

SetAttribute: name=QueryId op=('='|'<>' | '!=' |'<'|'<='|'>'|'>='|'in'|'like'|'between')? value=AttributeValueExpression;

AttributeValueExpression: Expr;

Expr: Add;

Add infers Expr:
    Mult ({infer BinExpr.e1=current} op=('+'|'-') e2=Mult)*;

Mult infers Expr: 
    Logical ({infer BinExpr.e1=current} op=('*'|'/') e2=Logical)*;

Logical infers Expr:
    Comparison ({infer BinExpr.e1=current} op=('or'|'and') e2=Comparison)*;

Comparison infers Expr:
    PrimExpr ({infer BinExpr.e1=current} op=('=' | '!=' | '<>'|'<'|'<='|'>'|'>='|'in'|'like') e2=PrimExpr)*;

PrimExpr: Literal | Group | NegExpr | NotExpr;

// grouped expression with parentheses
Group:      '(' ge=Expr ')';
// negated expression
NegExpr:    '-' ne=Expr;

NotExpr: 'not' '(' ne=Expr ')';

Boolean returns string: 'true' | 'false';

Decimal returns number: INT | INT '.' INT;

QueryId returns string: QualifiedName | QualifiedName '?';

TaggedId returns string: '@' ID;

Ref returns string: ID '.' (Ref | ID);

QualifiedName returns string: Ref | ID;

GenericName returns string: ID | STRING;

terminal ID returns string: NAME ('/' NAME)?;

// recognize an identifier
terminal NAME returns string: /[_a-zA-Z][\w_]*/;

// quoted strings
terminal STRING returns string:  '"' ( '\\' . | !('\\' | '"' | '\r' | '\n') | '\r'? '\n' )* '"';

// recognize an Integer (but represented via a 'number' type)
terminal INT returns number: /-?[0-9]+/;

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;


