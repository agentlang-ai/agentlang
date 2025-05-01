import * as fs from 'fs';
import { isSymbolObject } from 'util/types';

export enum TokenType {
    Undefined,
    Module, Entity, Record, Relationship, Event, Agent,
    Dataflow, Tag, Symbol, Eq, Lt, LtEq, Gt, GtEq, NotEq, Query,
    If, Else, ForEach, Try, Catch, Hash, OpenCurlyBrace, CloseCurlyBrace,
    OpenParen, CloseParen, OpenSquareParen, CloseSquareParen, Comma,
    Period, String, Number,
    EndOfSequence
}

export type Lexeme = {
    token: string | undefined;
    type: TokenType;
}

const eosLexeme: Lexeme = {
    token: undefined,
    type: TokenType.EndOfSequence
}

export function isEndOfSequence(lexeme: Lexeme) {
    return Object.is(lexeme, eosLexeme);
}

export type LexemeIterator = {
    lexemes: Lexeme[];
    offset: number;
}

function makeLexemeIterator(lexemes: Lexeme[]): LexemeIterator {
    let iter: LexemeIterator = {
        lexemes: lexemes,
        offset: 0
    }
    return iter;
}

function incIterOffset(iter: LexemeIterator): void {
    if (iter.offset == (iter.lexemes.length - 1)) return;
    ++iter.offset;
}

function decIterOffset(iter: LexemeIterator): void {
    if (iter.offset == 0) return;
    --iter.offset;
}

export function next(iter: LexemeIterator): Lexeme {
    if (iter.offset == 0) {
        incIterOffset(iter);
        return iter.lexemes[0];
    } else {
        let lexeme = iter.lexemes[iter.offset];
        incIterOffset(iter);
        return lexeme;
    }
}

export function peek(iter: LexemeIterator): Lexeme {
    if (iter.offset == (iter.lexemes.length - 1))
        return iter.lexemes[iter.offset];
    else
        return iter.lexemes[iter.offset + 1];
}

export function previous(iter: LexemeIterator): Lexeme {
    if (iter.offset == 0) {
        return iter.lexemes[0];
    } else {
        decIterOffset(iter);
        let lexeme = iter.lexemes[iter.offset];
        return lexeme;
    }
}

export function tokenize(code: string): LexemeIterator {
    let tokens: Lexeme[] = [];
    function pushToken(tok: string) {
        tokens.push(asLexeme(tok));
    }
    for (let i = 0; i < code.length; ++i) {
        let c = code[i];
        if (isWhitespace(c)) {
            let j: number = i + 1;
            while (true) {
                if ((j < code.length) && isWhitespace(code[j])) {
                    ++j;
                } else {
                    i = j;
                    break;
                }
            }
        } else if (isCmprOperator(c)) {
            let c2 = code[i + 1];
            if (isCmprOperator(c2)) {
                pushToken(c + c2);
                ++i;
            } else {
                pushToken(c);
            }
        } else if (c == '#' || c == '{' || c == '}'
            || c == '(' || c == ')' || c == ',' || c == '?') {
            pushToken(c)
        } else if (c == '.') {
            let c1 = code[i + 1]
            if (isDigit(c1)) {
                let s = "." + c1;
                i = pushNumber(i + 2, code, s, tokens);
            } else {
                pushToken(c);
            }
        } else if (isDigit(c)) {
            i = pushNumber(i, code, "", tokens);
        } else if (isSymbolStart(c)) {
            let s: string = c;
            let j: number = i + 1;
            for (; j < code.length; ++j) {
                c = code[j];
                if (isSymbolStart(c) || isSymbolChar(c)) {
                    s += c;
                } else {
                    break;
                }
            }
            let tp: TokenType = TokenType.Symbol;
            if (s.startsWith('@')) tp = TokenType.Tag;
            let lx: Lexeme = {
                token: s,
                type: tp
            }
            tokens.push(lx);
            i = j;
        } else if (c == '"') {
            let s: string = "";
            let j: number = i + 1;
            let last: string = "";
            for (; j < code.length; ++j) {
                c = code[j];
                if (c == '"') {
                    if (last = "\\") {
                        s += c;
                    } else {
                        break;
                    }
                } else {
                    s += c;
                }
            }
            let lx: Lexeme = {
                token: s,
                type: TokenType.String
            }
            tokens.push(lx);
            i = j + 1;
        } else {
            throw new Error("Invalid or misplaced character - " + c);
        }
    }
    tokens.push(eosLexeme);
    return makeLexemeIterator(tokens);
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

const NumRegex = /^[0-9]$/;

function isDigit(c: string) {
    return (c == '.') || (c.match(NumRegex) != null);
}

function assertNumber(s: string) {
    let v = parseFloat(s);
    if (Number.isNaN(v)) {
        throw new Error("Invalid numeric value - " + s);
    }
}

function pushNumber(offset: number, code: string, prefix: string, tokens: Lexeme[]): number {
    let j: number = offset;
    let c1: string;
    let s: string = prefix;
    for (; j < code.length; ++j) {
        c1 = code[j];
        if (isDigit(c1)) {
            s += c1;
        } else {
            break;
        }
    }
    assertNumber(s);
    let lx: Lexeme = {
        token: s,
        type: TokenType.Number
    };
    tokens.push(lx);
    return j;
}

const AlphaRegex = /^[a-z]$/i; // no international characters, as of now.

function isSymbolStart(c: string) {
    return (c == '@') || (c == '_') || (c.match(AlphaRegex) != null);
}

function isSymbolChar(c: string) {
    return (c == '_') || (c.match(AlphaRegex) != null) || (c.match(NumRegex) != null)
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
    else if (s == ".") lexeme.type = TokenType.Period
    else if (s == "?") lexeme.type = TokenType.Query
    else if (s == "if") lexeme.type = TokenType.If
    else if (s == "else") lexeme.type = TokenType.Else
    else if (s == "for") lexeme.type = TokenType.ForEach
    else if (s == "entity") lexeme.type = TokenType.Entity
    else if (s == "relationship") lexeme.type = TokenType.Relationship
    else if (s == "event") lexeme.type = TokenType.Event
    else if (s == "dataflow") lexeme.type = TokenType.Dataflow
    else if (s == "agent") lexeme.type = TokenType.Agent
    else if (s == "(") lexeme.type = TokenType.OpenParen
    else if (s == ")") lexeme.type = TokenType.CloseParen
    else if (s == "[") lexeme.type = TokenType.OpenSquareParen
    else if (s == "]") lexeme.type = TokenType.CloseSquareParen
    else if (s == "record") lexeme.type = TokenType.Record
    else if (s == "module") lexeme.type = TokenType.Module
    else lexeme.type = TokenType.Symbol
    return lexeme
}