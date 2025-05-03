grammar Agentlang

entry Model: (stmts+=Stmt | defs+=Def)*;

Def: 'def' name=ID '(' (params+=Param (',' params+=Param)*)? ')' Block;

fragment Block: '{' body+=Stmt* '}';

Stmt: Cmd | Macro;

Cmd: Pen | Move | Color | For;

Macro:  def=[Def:ID] '(' (args+=Expr (',' args+=Expr)*)? ')';

Param: name=ID;

Pen:    'pen' '(' mode=('up' | 'down') ')';

Move:   'move' '(' ex=Expr ',' ey=Expr ')';

For: 'for' var=Param '=' e1=Expr 'to' e2=Expr Block;

Color:  'color' '(' ((r = Expr ',' g=Expr ',' b=Expr) | color=ID | color=HEX) ')';

Expr: Add;

Add  infers Expr: 
    Mult ({infer BinExpr.e1=current} op=('+'|'-') e2=Mult)*;

Mult infers Expr: 
    PrimExpr ({infer BinExpr.e1=current} op=('*'|'/') e2=PrimExpr)*;
PrimExpr: Lit | Ref | Group | NegExpr;

// literal int
Lit:        val=INT;
// cross-reference to a parameter
Ref:        val=[Param:ID];
// grouped expression with parentheses
Group:      '(' ge=Expr ')';
// negated expression
NegExpr:    '-' ne=Expr;

// recognize a hexadecimal sequence, used to recognize colors for the 'Color' command
terminal HEX returns string:    /#(\d|[a-fA-F])+/;

// recognize an identifier
terminal ID returns string:     /[_a-zA-Z][\w_]*/;

// recognize an Integer (but represented via a 'number' type)
terminal INT returns number:    /-?[0-9]+/;

hidden terminal WS:             /\s+/;
hidden terminal ML_COMMENT:     /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT:     /\/\/[^\n\r]*/;


