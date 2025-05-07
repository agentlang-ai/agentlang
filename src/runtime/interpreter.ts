import { ArrayLiteral, FnCall, isLiteral, Literal, Pattern, Statement } from "../language/generated/ast.js";
import { getWorkflow, Instance, isEmptyWorkflow, isEventInstance, newInstanceAttributes, PlaceholderRecordEntry, WorkflowEntry } from "./module.js";
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
}

export function evaluate(eventInstance: Instance) {
    if (isEventInstance(eventInstance)) {
        let wf: WorkflowEntry = getWorkflow(eventInstance);
        let result: Result = EmptyResult;
        if (!isEmptyWorkflow(wf)) {
            let env: Environment = new Environment(eventInstance.name + ".env");
            wf.statements.forEach((stmt: Statement) => {
                result = evaluateStatement(stmt, env)
            })
        }
        return result;
    }
    throw new Error("Not an event - " + eventInstance.name)
}

function evaluateStatement(stmt: Statement, env: Environment): Result {
    let pat: Pattern = stmt.pattern
    if (isLiteral(pat.literal)) {
        return evaluateLiteral(pat.literal, env)
    }
    return EmptyResult
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