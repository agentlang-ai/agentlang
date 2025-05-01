import * as lxr from "./lexer";
import * as mod from "./module";

export function parse(lxms: lxr.LexemeIterator): boolean {
    while (true) {
        let lxm: lxr.Lexeme = lxr.next(lxms);
        if (lxr.isEndOfSequence(lxm)) {
            return true
        }
        switch (lxm.type) {
            case lxr.TokenType.Entity:
                defineEntity(lxms);
                break;
            case lxr.TokenType.Relationship:
                defineRelationship(lxms);
                break;
            case lxr.TokenType.Agent:
                defineAgent(lxms);
                break;
            case lxr.TokenType.Event:
                defineEvent(lxms);
                break;
            case lxr.TokenType.Record:
                defineRecord(lxms);
                break;
            case lxr.TokenType.Dataflow:
                defineDataflow(lxms);
                break;
            case lxr.TokenType.Module:
                defineModule(lxms);
                break;
            default:
                raiseParserError("Invalid top-level construct in input", lxm)
        }
    }
    maybeThrowParseError();
    return true;
}

function defineModule(lxms: lxr.LexemeIterator) {
    let lxm = lxr.next(lxms);
    if (lxm.type == lxr.TokenType.Symbol) {
        mod.addModule(lxm.token);
    } else {
        raiseParserError("Invalid module name", lxm)
    }
}

function defineEntity(lxms: lxr.LexemeIterator) {
    let lxm = lxr.next(lxms);
    if (lxm.type != lxr.TokenType.Symbol)
        raiseParserError("Invalid entity name", lxm)
    let entityName = lxm.token;
    lxm = lxr.next(lxms);
    if (lxm.type != lxr.TokenType.OpenCurlyBrace)
        raiseParserError("Missing {", lxm);
    let schema = parseSchema(lxms);
    // TODO: walk schemas array to construct internal entity map and add that to the module.
}

function defineRelationship(lxms: lxr.LexemeIterator) {
}

function defineEvent(lxms: lxr.LexemeIterator) {
}

function defineRecord(lxms: lxr.LexemeIterator) {
}

function defineDataflow(lxms: lxr.LexemeIterator) {
}

function defineAgent(lxms: lxr.LexemeIterator) {
}

function parseSchema(lxms: lxr.LexemeIterator) {
    let schemaLxms = [];
    while (true) {
        let lxm: lxr.Lexeme = lxr.next(lxms);
        let attrDef: lxr.Lexeme[] = [];
        while (lxm.type != lxr.TokenType.Comma && lxm.type != lxr.TokenType.EndOfSequence
            && lxm.type != lxr.TokenType.CloseCurlyBrace) {
            attrDef.push(lxm);
            lxm = lxr.next(lxms);
        }
        schemaLxms.push(attrDef);
        if (lxm.type == lxr.TokenType.Comma || lxm.type == lxr.TokenType.CloseCurlyBrace) {
            return schemaLxms;
        } else {
            lxm = lxr.next(lxms);
        }
    }
}

const MaxParserErrors = 10;
let parserErrorCount = 0;

function raiseParserError(msg: string, lxm: lxr.Lexeme): void {
    console.log("ParserError: " + msg + " - " + lxm.token);
    assertErrorLimit();
    ++parserErrorCount;
}

function assertErrorLimit() {
    if (parserErrorCount >= MaxParserErrors) {
        parserErrorCount = 0;
        throw new Error("Error loading model");
    }
}

function maybeThrowParseError() {
    if (parserErrorCount > 0) {
        parserErrorCount = MaxParserErrors;
        assertErrorLimit();
    }
}