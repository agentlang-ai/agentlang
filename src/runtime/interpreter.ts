import { ArrayLiteral, CrudMap, FnCall, ForEach, If, Literal, Pattern, Statement } from "../language/generated/ast.js";
import {
    arrayAsInstanceAttributes, getWorkflow, Instance, isEmptyWorkflow, isEventInstance, makeInstance,
    newInstanceAttributes, PlaceholderRecordEntry, WorkflowEntry
} from "./module.js";
import { invokeModuleFn, splitRefs } from "./util.js";

export type Result = any;

const EmptyResult: Result = null;

export function isEmptyResult(r: Result): boolean {
    return r == EmptyResult
}

class Environment extends Instance {
    parent: Environment | null;

    constructor(name: string, parent: Environment | null = null) {
        super(PlaceholderRecordEntry, name, newInstanceAttributes())
        this.parent = parent
    }

    override lookup(k: string): Result {
        let v = this.attributes.get(k);
        if (v == undefined) {
            if (this.parent != null) {
                return this.parent.lookup(k)
            } else return EmptyResult
        } else return v
    }

    bind(k: string, v: any) {
        this.attributes.set(k, v)
    }
}

export function evaluate(eventInstance: Instance) {
    if (isEventInstance(eventInstance)) {
        let wf: WorkflowEntry = getWorkflow(eventInstance);
        if (!isEmptyWorkflow(wf)) {
            let env: Environment = new Environment(eventInstance.name + ".env");
            return evaluateStatements(wf.statements, env)
        }
        return EmptyResult
    }
    throw new Error("Not an event - " + eventInstance.name)
}

function evaluateStatements(stmts: Statement[], env: Environment): Result {
    let result: Result = EmptyResult;
    stmts.forEach((stmt: Statement) => {
        result = evaluateStatement(stmt, env)
    })
    return result
}

function evaluateStatement(stmt: Statement, env: Environment): Result {
    let result: Result = evaluatePattern(stmt.pattern, env);
    if (stmt.alias != undefined) {
        let alias: string[] = stmt.alias
        if (result instanceof Array) {
            let resArr: Array<any> = result as Array<any>
            for (let i = 0; i < alias.length; ++i) {
                let k: string = alias[i];
                if (k == "_") {
                    env.bind(alias[i + 1], resArr.splice(i))
                    break
                } else {
                    env.bind(alias[i], resArr[i])
                }
            }
        } else {
            env.bind(alias[0], result)
        }
    }
    return result
}

function evaluatePattern(pat: Pattern, env: Environment): Result {
    let result: Result = EmptyResult;
    if (pat.literal != undefined) {
        result = evaluateLiteral(pat.literal, env)
    } else if (pat.crudMap != undefined) {
        result = evaluateCrudMap(pat.crudMap, env)
    } else if (pat.forEach != undefined) {
        result = evaluateForEach(pat.forEach, env)
    } else if (pat.if != undefined) {
        result = evaluateIf(pat.if, env)
    }
    return result
}

function evaluateLiteral(lit: Literal, env: Environment): Result {
    if (lit.id != undefined) return env.lookup(lit.id)
    else if (lit.ref != undefined) return followReference(env, lit.ref)
    else if (lit.fnCall != undefined) return applyFn(lit.fnCall, env)
    else if (lit.array != undefined) return realizeArray(lit.array, env)
    else if (lit.num != undefined) return lit.num
    else if (lit.str != undefined) return lit.str
    else if (lit.bool != undefined) return lit.bool
    return EmptyResult
}

function evaluateCrudMap(crud: CrudMap, env: Environment): Result {
    return makeInstance(crud.name, arrayAsInstanceAttributes(crud.attributes))
}

function evaluateForEach(forEach: ForEach, env: Environment): Result {
    let loopVar: string = forEach.var;
    let src: Result = evaluatePattern(forEach.src, env)
    if (src instanceof Array && src.length > 0) {
        let loopEnv: Environment = new Environment(env.name + ".child", env)
        let result: Result = EmptyResult
        for (let i = 0; i < src.length; ++i) {
            loopEnv.bind(loopVar, src[i])
            result = evaluateStatements(forEach.statements, loopEnv)
        }
        return result
    }
    return EmptyResult
}

function evaluateIf(ifStmt: If, env: Environment): Result {
    // TODO:
    return EmptyResult
}

function getRef(r: string, src: any): Result | undefined {
    if (src instanceof Instance)
        return src.lookup(r)
    else if (src instanceof Map)
        return src.get(r)
    else return undefined
}

function followReference(env: Environment, s: string): Result {
    let refs: string[] = splitRefs(s);
    let result: Result = EmptyResult;
    let src: any = env;
    for (let i = 0; i < refs.length; ++i) {
        let r: string = refs[i]
        let v: Result | undefined = getRef(r, src)
        if (v == undefined) return EmptyResult
        result = v
        src = v
    }
    return result
}

function applyFn(fnCall: FnCall, env: Environment): Result {
    let fnName: string = fnCall.name
    let args: Array<Result> = fnCall.args.flatMap((v: Literal) => {
        return evaluateLiteral(v, env)
    })
    return invokeModuleFn(fnName, args)
}

function realizeArray(array: ArrayLiteral, env: Environment): Result {
    return array.vals.flatMap((s: Statement) => {
        return evaluateStatement(s, env)
    })
}