grammar Agentlang

entry Module: 'module' name=ID (imports+=Import)* (defs+=Def)*;

Import: 'import' path=STRING 'as' name=ID;

Def: SchemaDef | Relationship | Workflow;
SchemaDef: Entity | Event | Record;

Property: (name=TaggedId '(' value=KvPairs ')') | name=TaggedId;

KvPair: value=Literal | key=ID ':' value=Literal;
KvPairs: pairs+=KvPair | pairs+=KvPair ',' pairs+=KvPair;

fragment RecDef: name=ID extends=ExtendsClause? '{' (attributes+=Attribute (',' attributes+=Attribute)*)+ (',' rbacSpec=RbacSpec?)? '}'?;

Entity: 'entity' RecDef;
Event: 'event' RecDef;
Record: 'record' RecDef;

ExtendsClause: 'extends' parentName=ID;

Relationship: 'relationship' name=ID type=('contains' | 'between') nodes=RelNodes properties+=Property*
('{' (attributes+=Attribute (',' attributes+=Attribute)*)+ '}')?;

Node: name=ID | name=ID 'as' alias=ID;

RelNodes: '(' node1=Node ',' node2=Node ')';

Attribute: name=ID (type=ID | arrayType=ID '['']') properties+=Property*;

RbacSpec: '@rbac' '[' (specEntries+=RbacSpecEntries (',' specEntries+=RbacSpecEntries)*)+ ']';

RbacSpecEntry: role=RbacRolesSpec | allow=RbacAllowSpec | expr=RbacExpressionSpec;

RbacSpecEntries: '(' (entries+=RbacSpecEntry (',' entries+=RbacSpecEntry)*)+ ')';

RbacRolesSpec: 'roles' ':' '[' (roles+=ID (',' roles+=ID)*)+ ']';

RbacAllowSpec: 'allow' ':' '[' (oprs+=RbacOpr (',' oprs+=RbacOpr)*)+ ']';

RbacOpr: value=('create' | 'delete' | 'update' | 'read');

RbacExpressionSpec: 'where' ':' lhs=Ref '=' rhs=Ref;

ArrayLiteral: '[' ']' | '[' vals+=Statement (',' vals+=Statement)* ']';

FnCall: name=(ID | Ref) (('(' ')') | ('(' (args+=Literal (',' args+=Literal)*)+ ')'));

Literal: (id=ID | num=Decimal | str=STRING | ref=Ref | bool=Boolean | fnCall=FnCall | array=ArrayLiteral);

fragment Body: '{' (statements+=Statement (';' statements+=Statement)*)+ '}' | '{' statements+=Statement ';'+ '}' | statements+=Statement;

Workflow: 'workflow' name=ID Body;

Pattern: literal=Literal | crudMap=CrudMap | if=If | forEach=ForEach | delete=Delete | upsert=Upsert;

Statement: pattern=Pattern ('as' (alias=ID | ('[' aliases+=ID (',' aliases+=ID)*)+ ']'))? throws=Throws?;

CrudMap: QueryAllPattern | '{' name=ID '{' (attributes+=SetAttribute (',' attributes+=SetAttribute)*)+ properties+=Property* '}'
             (',' relationships+=RelationshipPattern (',' relationships+=RelationshipPattern)*)? '}';

QueryAllPattern: '{' name=QueryId '{''}' (',' relationships+=RelationshipPattern (',' relationships+=RelationshipPattern)*)? '}';

RelationshipPattern: name=ID pattern=Pattern;

Throws: 'throws' '{' (handlers+=Handler)+ '}';

Handler: ('not_found' | 'error') Statement;

If: 'if' '(' cond=LogicalExpression ')' Body (elseif=ElseIf | else=Else)?;

ElseIf infers If: 'else' 'if' '(' cond=LogicalExpression ')' Body;

Else: 'else' Body;

ForEach: 'for' var=ID 'in' src=Pattern Body;

Delete: 'delete' pattern=Pattern;

Upsert: 'upsert' pattern=CrudMap;

SetAttribute: name=QueryId op=('='|'<>'|'<'|'<='|'>'|'>='|'in'|'like'|'between'|'+')? value=AttributeValueExpression;

AttributeValueExpression: Expr;

LogicalExpression: expr=ComparisonExpression | expr=OrAnd;
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

// recognize an identifier
terminal ID returns string: /[_a-zA-Z][\w_]*/;

// quoted strings
terminal STRING returns string: /(["'])((\\{2})*|(.*?[^\\](\\{2})*))\1/;

// recognize an Integer (but represented via a 'number' type)
terminal INT returns number: /-?[0-9]+/;

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;


