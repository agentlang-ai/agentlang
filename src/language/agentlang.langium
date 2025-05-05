grammar Agentlang

entry Module: 'module' name=ID (defs+=Def)*;

Def: SchemaDef | Relationship | Workflow;
SchemaDef: Entity | Event | Record;

Property: name=TaggedId '=' value=Literal;

Properties: '(' (properties+=Property (',' properties+=Property)*)+ ')';

fragment RecDef: name=ID '{' (attributes+=Attribute (',' attributes+=Attribute)*)+ '}';

Entity: 'entity' RecDef;
Event: 'event' RecDef;
Record: 'record' RecDef;

Relationship: 'relationship' name=ID ('contains' | 'between') '[' node1=Node ',' node2=Node ']' Properties?;

Node: name=ID | name=ID 'as' alias=ID;

Attribute: name=ID type=ID props=Properties?;

Literal: val=(ID | Decimal | STRING | Ref | Boolean);

fragment Body: '{' (patterns+=Pattern (';' patterns+=Pattern)*)+ '}' | patterns+=Pattern;

Workflow: 'workflow' name=ID Body;

RawPattern: Literal | CrudMap | If | ForEach;

Pattern: pat=RawPattern ('as' (alias+=ID | ('[' alias+=ID (',' alias+=ID)*)+ ']'))?;

CrudMap: '{' name=ID '{' (attributes+=AttributeValue (',' attributes+=AttributeValue)*)+ props=Properties? throws=Throws? '}' '}';

Throws: 'throws' '{' (handlers+=Handler)+ '}';

Handler: ('not_found' | 'error') Pattern;

If: 'if' '(' cond=LogicalExpression ')' Body ElseIf?;
ElseIf infers If: 'else' 'if' '(' cond=LogicalExpression ')' Body | 'else' Body;
IfBody: Pattern;

ForEach: 'for' var=ID 'in' src=RawPattern Body;

AttributeValue: name=QueryId ('='|'<>'|'<'|'<='|'>'|'>='|'in'|'like'|'between')? value=AttributeValueExpression;

AttributeValueExpression: Expr;

LogicalExpression: LogExpr;

LogExpr infers LogicalExpression:
    ComparisonExpression({infer ComparisonExpression.e1=current} op=('and'|'or') e2=ComparisonExpression)*;

ComparisonExpression:
    e1=Expr op=('='|'<>'|'<'|'<='|'>'|'>='|'in'|'like'|'between') e2=Expr;

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

// recognize a hexadecimal sequence, used to recognize colors for the 'Color' command
terminal HEX returns string: /#(\d|[a-fA-F])+/;

// recognize an identifier
terminal ID returns string: /[_a-zA-Z][\w_]*/;

// quoted strings
terminal STRING returns string: /(["'])((\\{2})*|(.*?[^\\](\\{2})*))\1/;

// recognize an Integer (but represented via a 'number' type)
terminal INT returns number: /-?[0-9]+/;

hidden terminal WS: /\s+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;


