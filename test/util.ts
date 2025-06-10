import { runPostInitTasks, runPreInitTasks } from "../src/cli/main.js";
import { parseAndIntern } from "../src/runtime/loader.js";
import { logger } from "../src/runtime/logger.js";

let CoreModulesInited = false

export async function doPreInit() {
    if (!CoreModulesInited) {
        await runPreInitTasks()
        CoreModulesInited = true
    }
}

export async function doInternModule(code: string) {
    await doPreInit()
    await parseAndIntern(code)
    await runPostInitTasks()
}

function DefaultErrorHandler(err: any): PromiseLike<never> {
    throw new Error(err)
}

export class ErrorHandler {
    isFailed: boolean = false
    handler: ((r: any) => PromiseLike<never>) | undefined

    constructor() {
        this.handler = undefined
    }

    f(): (r: any) => PromiseLike<never> {
        if (this.handler)
            return this.handler
        else
            return DefaultErrorHandler
    }
}

export function expectError(): ErrorHandler {
    const eh = new ErrorHandler()
    const f = function (err: any) {
        logger.info(`Expected ${err}`)
        eh.isFailed = true
    } as (r: any) => PromiseLike<never>
    eh.handler = f
    return eh
}