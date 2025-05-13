import {
    ArrayLiteral, ComparisonExpression, CrudMap, Expr, FnCall, ForEach, If, isBinExpr, isComparisonExpression,
    isGroup, isLiteral, isNegExpr, isOrAnd, Literal, LogicalExpression, OrAnd, Pattern, SetAttribute, Statement
} from "../language/generated/ast.js";
import {
    getWorkflow, Instance, InstanceAttributes, isEmptyWorkflow, isEventInstance, makeInstance,
    newInstanceAttributes, PlaceholderRecordEntry, WorkflowEntry
} from "./module.js";
import { invokeModuleFn, isFqName, makeFqName, Path, splitFqName, splitRefs } from "./util.js";

export type Result = any;

const EmptyResult: Result = null;

export function isEmptyResult(r: Result): boolean {
    return r == EmptyResult
}

class Environment extends Instance {
    parent: Environment | null;

    private static ActiveModuleKey: string = "--active-module--"
    private static ActiveEventKey: string = "--active-event--"

    constructor(name: string, parent: Environment | null = null) {
        super(PlaceholderRecordEntry, name, newInstanceAttributes())
        this.parent = parent
    }

    override lookup(k: string): Result {
        const v = this.attributes.get(k);
        if (v == undefined) {
            if (this.parent != null) {
                return this.parent.lookup(k)
            } else return EmptyResult
        } else return v
    }

    bind(k: string, v: any) {
        this.attributes.set(k, v)
    }

    bindInstance(inst: Instance): Path {
        const fqName: string = inst.name
        const path: Path = splitFqName(fqName)
        if (!path.hasModule())
            throw new Error(`Instance name must be fully-qualified - ${inst.name}`)
        const n: string = path.getEntryName()
        this.attributes.set(fqName, inst)
        if (!this.attributes.has(n))
            this.attributes.set(n, inst)
        return path
    }

    bindActiveEvent(eventInst: Instance): Path {
        if (!isEventInstance(eventInst))
            throw new Error(`Not an event instance - ${eventInst.name}`)
        const path: Path = this.bindInstance(eventInst)
        this.attributes.set(Environment.ActiveModuleKey, path.getModuleName())
        this.attributes.set(Environment.ActiveEventKey, eventInst.name)
        return path
    }

    getActiveModuleName(): string {
        return this.attributes.get(Environment.ActiveModuleKey)
    }

    getActiveEvent(): Instance {
        return this.attributes.get(this.attributes.get(Environment.ActiveEventKey))
    }
}

export function evaluate(eventInstance: Instance) {
    if (isEventInstance(eventInstance)) {
        const wf: WorkflowEntry = getWorkflow(eventInstance);
        if (!isEmptyWorkflow(wf)) {
            const env: Environment = new Environment(eventInstance.name + ".env");
            env.bindActiveEvent(eventInstance)
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
    const result: Result = evaluatePattern(stmt.pattern, env);
    if (stmt.alias != undefined) {
        const alias: string[] = stmt.alias
        if (result instanceof Array) {
            const resArr: Array<any> = result as Array<any>
            for (let i = 0; i < alias.length; ++i) {
                const k: string = alias[i];
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

function asFqName(n: string, env: Environment): string {
    if (isFqName(n)) return n
    return makeFqName(env.getActiveModuleName(), n)
}

function evaluateCrudMap(crud: CrudMap, env: Environment): Result {
    const attrs: InstanceAttributes = newInstanceAttributes()
    let qattrs: InstanceAttributes | undefined = undefined
    crud.attributes.forEach((a: SetAttribute) => {
        const v: Result = evaluateExpression(a.value, env)
        let aname: string = a.name
        if (aname.endsWith("?")) {
            if (qattrs == undefined)
                qattrs = newInstanceAttributes()
            aname = aname.slice(0, aname.length - 1)
            qattrs.set(aname, a.op)
        }
        attrs.set(aname, v)
    })
    return makeInstance(asFqName(crud.name, env), attrs, qattrs)
}

function evaluateForEach(forEach: ForEach, env: Environment): Result {
    const loopVar: string = forEach.var;
    const src: Result = evaluatePattern(forEach.src, env)
    if (src instanceof Array && src.length > 0) {
        const loopEnv: Environment = new Environment(env.name + ".child", env)
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
    if (evaluateLogicalExpression(ifStmt.cond, env)) {
        return evaluateStatements(ifStmt.statements, env)
    } else if (ifStmt.elseif != undefined) {
        return evaluateIf(ifStmt.elseif, env)
    } else if (ifStmt.else != undefined) {
        return evaluateStatements(ifStmt.else.statements, env)
    }
    return EmptyResult
}

function evaluateLogicalExpression(logExpr: LogicalExpression, env: Environment): Result {
    if (isComparisonExpression(logExpr.expr)) {
        return evaluateComparisonExpression(logExpr.expr, env)
    } else if (isOrAnd(logExpr.expr)) {
        return evaluateOrAnd(logExpr.expr, env)
    }
    return EmptyResult
}

function evaluateComparisonExpression(cmprExpr: ComparisonExpression, env: Environment): Result {
    const v1 = evaluateExpression(cmprExpr.e1, env)
    const v2 = evaluateExpression(cmprExpr.e2, env)
    switch (cmprExpr.op) {
        case '=': return v1 == v2;
        case '<': return v1 < v2;
        case '>': return v1 > v2;
        case '<=': return v1 <= v2;
        case '>=': return v1 >= v2;
        case '<>': return v1 != v2;
        case 'like': return v1.startsWith(v2)
        case 'in': return v2.find((x: any) => { x == v1 })
        default: throw new Error(`Invalid comparison operator ${cmprExpr.op}`)
    }
    return EmptyResult
}

function evaluateExpression(expr: Expr, env: Environment): Result {
    if (isBinExpr(expr)) {
        const v1 = evaluateExpression(expr.e1, env);
        const v2 = evaluateExpression(expr.e2, env);
        switch (expr.op) {
            case '+': return v1 + v2;
            case '-': return v1 - v2;
            case '*': return v1 * v2;
            case '/': return v1 / v2;
            default: throw new Error(`Unrecognized binary operator: ${expr.op}`);
        }
    } else if (isNegExpr(expr)) {
        return -1 * evaluateExpression(expr.ne, env)
    } else if (isGroup(expr)) {
        return evaluateExpression(expr.ge, env)
    } else if (isLiteral(expr)) {
        return evaluateLiteral(expr, env)
    }
    return EmptyResult
}

function evaluateOrAnd(orAnd: OrAnd, env: Environment): Result {
    switch (orAnd.op) {
        case 'or': return evaluateOr(orAnd.exprs, env);
        case 'and': return evaluateAnd(orAnd.exprs, env);
        default: throw new Error(`Invalid logical operator: ${orAnd.op}`)
    }
}

function evaluateOr(exprs: LogicalExpression[], env: Environment): Result {
    for (let i = 0; i < exprs.length; ++i) {
        if (evaluateLogicalExpression(exprs[i], env))
            return true
    }
    return false
}

function evaluateAnd(exprs: LogicalExpression[], env: Environment): Result {
    for (let i = 0; i < exprs.length; ++i) {
        if (!evaluateLogicalExpression(exprs[i], env))
            return false
    }
    return true
}

function getRef(r: string, src: any): Result | undefined {
    if (src instanceof Instance)
        return src.lookup(r)
    else if (src instanceof Map)
        return src.get(r)
    else return undefined
}

function followReference(env: Environment, s: string): Result {
    const refs: string[] = splitRefs(s);
    let result: Result = EmptyResult;
    let src: any = env;
    for (let i = 0; i < refs.length; ++i) {
        const r: string = refs[i]
        const v: Result | undefined = getRef(r, src)
        if (v == undefined) return EmptyResult
        result = v
        src = v
    }
    return result
}

function applyFn(fnCall: FnCall, env: Environment): Result {
    const fnName: string | undefined = fnCall.name
    if (fnName != undefined) {
        let args: Array<Result> | null = null;
        if (fnCall.args != undefined) {
            args = fnCall.args.flatMap((v: Literal) => {
                return evaluateLiteral(v, env)
            })
        }
        return invokeModuleFn(fnName, args)
    }
    return EmptyResult
}

function realizeArray(array: ArrayLiteral, env: Environment): Result {
    return array.vals.flatMap((s: Statement) => {
        return evaluateStatement(s, env)
    })
}