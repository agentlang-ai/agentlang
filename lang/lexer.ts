import * as fs from 'fs';

export enum TokenType {
    Undefined,
    Module, Entity, Record, Event, Agent,
    Dataflow, Tag, Symbol, Eq, Lt, LtEq, Gt, GtEq, NotEq,
    If, Else, ForEach, Try, Catch, Hash, OpenCurlyBrace, CloseCurlyBrace,
    OpenParen, CloseParen, OpenSquareParen, CloseSquareParen, Comma
}

export type Lexeme = {
    token: string;
    type: TokenType;
}

export function tokenize(code: string) {
    let currentToken: string = "";
    let tokens: Lexeme[] = [];
    function pushTokens(tok1) {
        tokens.push(asLexeme(currentToken));
        tokens.push(asLexeme(tok1));
        currentToken = ""
    }
    for (let i = 0; i < code.length; ++i) {
        let c = code[i];
        if (isWhitespace(c)) {
            if (currentToken.length > 0) {
                tokens.push(asLexeme(currentToken));
                currentToken = ""
            }
        } else if (isCmprOperator(c)) {
            let c2 = code[i + 1];
            if (isCmprOperator(c2)) {
                pushTokens(c + c2);
                ++i;
            } else {
                pushTokens(c);
            }
        } else if (c == "#" || c == "{" || c == "}"
            || c == '(' || c == ')' || c == ',') {
            pushTokens(c)
        } else {
            currentToken += c;
        }
    }
    return tokens;
}

export function tokenizeFile(fileName: string) {
    return tokenize(fs.readFileSync(fileName, 'utf8'));
}

function isWhitespace(c: string) {
    if (c == ' ' || c == '\n' || c == '\r' || c == '\t') {
        return true
    }
    return false
}

function isCmprOperator(c: string) {
    if (c == '=' || c == '>' || c == '<') {
        return true
    }
    return false
}

function asLexeme(s: string): Lexeme {
    let lexeme: Lexeme = {
        token: s,
        type: TokenType.Undefined
    }
    if (s == "{") lexeme.type = TokenType.OpenCurlyBrace
    else if (s == "}") lexeme.type = TokenType.CloseCurlyBrace
    else if (s == ",") lexeme.type = TokenType.Comma
    else if (s == "#") lexeme.type = TokenType.Hash
    else if (s == "if") lexeme.type = TokenType.If
    else if (s == "else") lexeme.type = TokenType.Else
    else if (s == "for") lexeme.type = TokenType.ForEach
    else if (s == "entity") lexeme.type = TokenType.Entity
    else if (s == "event") lexeme.type = TokenType.Event
    else if (s == "dataflow") lexeme.type = TokenType.Dataflow
    else if (s == "agent") lexeme.type = TokenType.Agent
    else if (s == "(") lexeme.type = TokenType.OpenParen
    else if (s == ")") lexeme.type = TokenType.CloseParen
    else if (s == "[") lexeme.type = TokenType.OpenSquareParen
    else if (s == "]") lexeme.type = TokenType.CloseSquareParen
    else if (s == "record") lexeme.type = TokenType.Record
    else if (s == "module") lexeme.type = TokenType.Module
    else throw new Error("Invalid token in input - " + s)
    return lexeme
}

//console.log(tokenizeFile("./lang/lexer.ts"));
async function test_import(s: string) {
    let m = await import(s);
    let f = eval("(a, b) => m.add(a, b)");
    console.log(f(10, 20))
}

test_import("/home/vijaym/Desktop/hello.js");