import chalk from 'chalk'
import express, { Request, Response } from 'express'
import { getAllEventNames } from '../runtime/module.js'

export function startServer(appName: string, port: number) {
    const app = express()

    app.get('/', (req: Request, res: Response) => {
        res.send(appName)
    })

    let eventNames: Map<string, string[]> = getAllEventNames()
    eventNames.forEach((eventNames: string[], moduleName: string) => {
        eventNames.forEach((n: string) => {
            app.post(`/${moduleName}/${n}`, (req: Request, res: Response) => {
                handleEventPost(n, req, res)
            })
        })
    })

    app.listen(port, () => {
        console.log(chalk.green(`Application ${chalk.bold(appName)} started on port ${chalk.bold(port)}`))
    })
}

function handleEventPost(eventName: string, req: Request, res: Response): void {
    res.send(`POST ${eventName}`)
}
