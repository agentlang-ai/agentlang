grammar Agentlang

entry ModuleDefinition: 'module' name=ID (imports+=Import)* (defs+=Definition)*;

Import: 'import' path=STRING 'as' name=ID;

Definition: SchemaDefinition | RelationshipDefinition | WorkflowDefinition | StandaloneStatement | AgentDefinition;

StandaloneStatement: stmt=Statement;

SchemaDefinition: EntityDefinition | EventDefinition | RecordDefinition;

PropertyDefinition: (name=TaggedId '(' value=KvPairs ')') | name=TaggedId;

KvPair: value=Literal | key=ID ':' value=Literal;
KvPairs: pairs+=KvPair | pairs+=KvPair ',' pairs+=KvPair;

RecordSchemaDefinition: '{''}' | '{' (attributes+=AttributeDefinition (',' attributes+=AttributeDefinition)*)+
(',' extras+=RecordExtraDefinition (',' extras+=RecordExtraDefinition)*)? '}';

RecordExtraDefinition: rbacSpec=RbacSpecDefinition | meta=MetaDefinition | prePost=PrePostTriggerDefinition | uq=CompositeUniqueDefinition;

fragment RecDef: name=ID extends=ExtendsClause? schema=RecordSchemaDefinition;

EntityDefinition: 'entity' RecDef;
EventDefinition: 'event' RecDef;
RecordDefinition: 'record' RecDef;

ExtendsClause: 'extends' parentName=ID;

RelationshipDefinition: 'relationship' name=ID type=('contains' | 'between') nodes=RelNodes properties+=PropertyDefinition*
(schema=RecordSchemaDefinition)?;

NodeDefinition: name=ID | name=ID 'as' alias=ID;

RelNodes: '(' node1=NodeDefinition ',' node2=NodeDefinition ')';

AttributeDefinition: name=ID (type=ID | arrayType=ID '['']' | oneOfSpec=OneOfSpec | enumSpec=EnumSpec 
| refSpec=RefSpec) ('@expr' '(' expr=Expr ')')? properties+=PropertyDefinition*;

EnumSpec: '@enum' '(' values+=STRING (',' values+=STRING)* ')';

OneOfSpec: '@oneof' '(' ref=Ref ')';

RefSpec: '@ref' '(' ref=ID ')';

RbacSpecDefinition: '@rbac' '[' (specEntries+=RbacSpecEntries (',' specEntries+=RbacSpecEntries)*)+ ']';

RbacSpecEntry: role=RbacRolesSpec | allow=RbacAllowSpec | expr=RbacExpressionSpec;

RbacSpecEntries: '(' (entries+=RbacSpecEntry (',' entries+=RbacSpecEntry)*)+ ')';

RbacRolesSpec: 'roles' ':' '[' (roles+=ID (',' roles+=ID)*)+ ']';

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

ArrayLiteral: '[' ']' | '[' vals+=Statement (',' vals+=Statement)* ']';

MapLiteral: '{' entries+=MapEntry (',' entries+=MapEntry)* '}';

MapEntry: key=MapKey ':' value=Literal;

MapKey: str=STRING | num=Decimal | bool=Boolean;

FnCall: name=(ID | Ref) (('(' ')') | ('(' (args+=Literal (',' args+=Literal)*)+ ')'));

AsyncFnCall: 'await' fnCall=FnCall;

Literal: (id=ID | num=Decimal | str=STRING | ref=Ref | bool=Boolean | fnCall=FnCall | asyncFnCall=AsyncFnCall | array=ArrayLiteral | map=MapLiteral);

fragment Body: '{' '}' | '{' (statements+=Statement (';' statements+=Statement)*)+ '}' | '{' statements+=Statement ';'+ '}' | statements+=Statement;

WorkflowDefinition: 'workflow' name=ID Body;

Pattern: literal=Literal | crudMap=CrudMap | if=If | forEach=ForEach | delete=Delete | purge=Purge 
| upsert=Upsert | fullTextSearch=FullTextSearch;

Statement: pattern=Pattern hints+=RuntimeHint*;

RuntimeHint: aliasSpec=AliasSpec | catchSpec=CatchSpec;

AliasSpec: ('as' (alias=ID | '[' ( aliases+=ID (',' aliases+=ID)*)+ ']'));

CrudMap: '{' (name=QueryId '{''}' | name=ID body=CrudMapBody)
             (',' relationships+=RelationshipPattern (',' relationships+=RelationshipPattern)*)? 
             (',' into=SelectIntoSpec)? '}';

CrudMapBody: '{' (attributes+=SetAttribute (',' attributes+=SetAttribute)*)+ properties+=PropertyDefinition* '}';

SelectIntoSpec: 'into' '{' entries+=SelectIntoEntry (',' entries+=SelectIntoEntry)* '}';

SelectIntoEntry: alias=ID attribute=Ref;

FullTextSearch: '{' name=QueryId query=Literal options=MapLiteral? '}';

AgentDefinition: 'agent' name=(ID | STRING) body=CrudMapBody;

RelationshipPattern: name=ID pattern=Pattern;

CatchSpec: 'catch' '{' (handlers+=Handler)+ '}';

Handler: except=('not_found' | 'error') stmt=Statement;

If: 'if' '(' cond=Expr ')' Body else=Else?;

Else: 'else' Body;

ForEach: 'for' var=ID 'in' src=Pattern Body;

Delete: 'delete' pattern=Pattern;

Purge: 'purge' pattern=Pattern;

Upsert: 'upsert' pattern=CrudMap;

SetAttribute: name=QueryId op=('='|'<>'|'<'|'<='|'>'|'>='|'in'|'like'|'between')? value=AttributeValueExpression;

AttributeValueExpression: Expr;

Expr: Add;

Add infers Expr:
    Mult ({infer BinExpr.e1=current} op=('+'|'-') e2=Mult)*;

Mult infers Expr: 
    Logical ({infer BinExpr.e1=current} op=('*'|'/') e2=Logical)*;

Logical infers Expr:
    Comparison ({infer BinExpr.e1=current} op=('or'|'and') e2=Comparison)*;

Comparison infers Expr:
    PrimExpr ({infer BinExpr.e1=current} op=('='|'<>'|'<'|'<='|'>'|'>='|'in'|'like') e2=PrimExpr)*;

PrimExpr: Literal | Group | NegExpr | NotExpr;

// grouped expression with parentheses
Group:      '(' ge=Expr ')';
// negated expression
NegExpr:    '-' ne=Expr;

NotExpr: 'not' '(' ne=Expr ')';

Boolean returns string: 'true' | 'false';

Decimal returns number: INT | INT '.' INT;

QueryId returns string: ID | ID '?';

TaggedId returns string: '@' ID;

Ref returns string: ID '.' (Ref | ID);

terminal ID returns string: NAME ('/' NAME)?;

// recognize an identifier
terminal NAME returns string: /[_a-zA-Z][\w_]*/;

// quoted strings
terminal STRING returns string: /(["'])((\\{2})*|(.*?[^\\](\\{2})*))\1/;

// recognize an Integer (but represented via a 'number' type)
terminal INT returns number: /-?[0-9]+/;

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;


