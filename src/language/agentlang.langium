grammar Agentlang

entry ModuleDefinition: 'module' name=ID (imports+=Import)* (defs+=Definition)*;

Import: 'import' path=STRING 'as' name=ID;

Definition: SchemaDef | RelationshipDefinition | WorkflowDefinition | StandaloneStatement;

StandaloneStatement: stmt=Statement;

SchemaDef: EntityDefinition | EventDefinition | RecordDefinition | ComponentDefinition;

PropertyDefinition: (name=TaggedId '(' value=KvPairs ')') | name=TaggedId;

KvPair: value=Literal | key=ID ':' value=Literal;
KvPairs: pairs+=KvPair | pairs+=KvPair ',' pairs+=KvPair;

RecAttrs: '{''}' | '{' (attributes+=AttributeDefinition (',' attributes+=AttributeDefinition)*)+ (',' rbacSpec=RbacSpecDefinition?)? '}'?;
fragment RecDef: name=ID extends=ExtendsClause? schema=RecAttrs;

EntityDefinition: 'entity' RecDef;
EventDefinition: 'event' RecDef;
RecordDefinition: 'record' RecDef;

ComponentDefinition: 'component' name=ID schema=ComponentSpec;
ComponentSpec: '{''}' | '{' (entries+=ComponentSpecEntry (',' entries+=ComponentSpecEntry)*)+ '}';
ComponentSpecEntry: name=ID value=Literal;

ExtendsClause: 'extends' parentName=ID;

RelationshipDefinition: 'relationship' name=ID type=('contains' | 'between') nodes=RelNodes properties+=PropertyDefinition*
('{' (attributes+=AttributeDefinition (',' attributes+=AttributeDefinition)*)+ '}')?;

NodeDefinition: name=ID | name=ID 'as' alias=ID;

RelNodes: '(' node1=NodeDefinition ',' node2=NodeDefinition ')';

AttributeDefinition: name=ID (type=ID | arrayType=ID '['']' | oneOfSpec=OneOfSpec) properties+=PropertyDefinition*;

OneOfSpec: '@oneof' '(' values+=STRING (',' values+=STRING)* ')';

RbacSpecDefinition: '@rbac' '[' (specEntries+=RbacSpecEntries (',' specEntries+=RbacSpecEntries)*)+ ']';

RbacSpecEntry: role=RbacRolesSpec | allow=RbacAllowSpec | expr=RbacExpressionSpec;

RbacSpecEntries: '(' (entries+=RbacSpecEntry (',' entries+=RbacSpecEntry)*)+ ')';

RbacRolesSpec: 'roles' ':' '[' (roles+=ID (',' roles+=ID)*)+ ']';

RbacAllowSpec: 'allow' ':' '[' (oprs+=RbacOpr (',' oprs+=RbacOpr)*)+ ']';

RbacOpr: value=('create' | 'delete' | 'update' | 'read');

RbacExpressionSpec: 'where' ':' lhs=Ref '=' rhs=Ref;

ArrayLiteral: '[' ']' | '[' vals+=Statement (',' vals+=Statement)* ']';

MapLiteral: '#' '{' entries+=MapEntry (',' entries+=MapEntry)* '}';

MapEntry: key=STRING ':' value=Literal;

FnCall: name=(ID | Ref) (('(' ')') | ('(' (args+=Literal (',' args+=Literal)*)+ ')'));

AsyncFnCall: 'await' fnCall=FnCall;

Literal: (id=ID | num=Decimal | str=STRING | ref=Ref | bool=Boolean | fnCall=FnCall | asyncFnCall=AsyncFnCall | array=ArrayLiteral | map=MapLiteral);

fragment Body: '{' '}' | '{' (statements+=Statement (';' statements+=Statement)*)+ '}' | '{' statements+=Statement ';'+ '}' | statements+=Statement;

WorkflowDefinition: 'workflow' name=ID Body;

Pattern: literal=Literal | crudMap=CrudMap | if=If | forEach=ForEach | delete=Delete | purge=Purge | upsert=Upsert;

Statement: pattern=Pattern ('as' (alias=ID | ('[' aliases+=ID (',' aliases+=ID)*)+ ']'))? throws=Throws?;

CrudMap: QueryAllPattern | '{' name=ID '{' (attributes+=SetAttribute (',' attributes+=SetAttribute)*)+ properties+=PropertyDefinition* '}'
             (',' relationships+=RelationshipPattern (',' relationships+=RelationshipPattern)*)? '}';

QueryAllPattern: '{' name=QueryId '{''}' (',' relationships+=RelationshipPattern (',' relationships+=RelationshipPattern)*)? '}';

RelationshipPattern: name=ID pattern=Pattern;

Throws: 'throws' '{' (handlers+=Handler)+ '}';

Handler: ('not_found' | 'error') Statement;

If: 'if' '(' cond=LogicalExpression ')' Body else=Else?;

Else: 'else' Body;

ForEach: 'for' var=ID 'in' src=Pattern Body;

Delete: 'delete' pattern=Pattern;

Purge: 'purge' pattern=Pattern;

Upsert: 'upsert' pattern=CrudMap;

SetAttribute: name=QueryId op=('='|'<>'|'<'|'<='|'>'|'>='|'in'|'like'|'between')? value=AttributeValueExpression;

AttributeValueExpression: Expr;

LogicalExpression: expr=ComparisonExpression | expr=OrAnd | expr=Literal;
OrAnd: op=('or' | 'and') '(' (exprs+=LogicalExpression (',' exprs+=LogicalExpression)*)*')';

ComparisonExpression:
    e1=Expr op=('='|'<>'|'<'|'<='|'>'|'>='|'in'|'like') e2=Expr;

Expr: Add;

Add infers Expr:
    Mult ({infer BinExpr.e1=current} op=('+'|'-') e2=Mult)*;

Mult infers Expr: 
    PrimExpr ({infer BinExpr.e1=current} op=('*'|'/') e2=PrimExpr)*;

PrimExpr: Literal | Group | NegExpr;

// grouped expression with parentheses
Group:      '(' ge=Expr ')';
// negated expression
NegExpr:    '-' ne=Expr;

Boolean returns string: 'true' | 'false';

Decimal returns number: INT | INT '.' INT;

QueryId returns string: ID | ID '?';

TaggedId returns string: '@' ID;

Ref returns string: ID '.' ID;

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


