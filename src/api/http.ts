import chalk from 'chalk'
import express, { Request, Response } from 'express'
import { getAllEventNames, Instance, makeInstance, objectAsInstanceAttributes } from '../runtime/module.js'
import { evaluate, Result } from '../runtime/interpreter.js'
import { makeFqName } from '../runtime/util.js'

export function startServer(appName: string, port: number) {
    const app = express()
    app.use(express.json())

    app.get('/', (req: Request, res: Response) => {
        res.send(appName)
    })

    let eventNames: Map<string, string[]> = getAllEventNames()
    eventNames.forEach((eventNames: string[], moduleName: string) => {
        eventNames.forEach((n: string) => {
            app.post(`/${moduleName}/${n}`, (req: Request, res: Response) => {
                handleEventPost(makeFqName(moduleName, n), req, res)
            })
        })
    })

    app.listen(port, () => {
        console.log(chalk.green(`Application ${chalk.bold(appName)} started on port ${chalk.bold(port)}`))
    })
}

function handleEventPost(eventName: string, req: Request, res: Response): void {
    let inst: Instance = makeInstance(eventName, objectAsInstanceAttributes(req.body))
    let result: Result = normalizedResult(evaluate(inst))
    console.log(JSON.stringify(result as Object))
    res.send(JSON.stringify(result))
}

function normalizedResult(r: Result): Result {
    if (r instanceof Array) {
        return r.map((x: Result) => {
            return normalizedResult(x)
        })
    } else if (r instanceof Instance) {
        return r.asObject()
    } else {
        return r
    }
}
