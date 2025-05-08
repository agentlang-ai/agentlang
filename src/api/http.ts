import chalk from 'chalk'
import express, { Request, Response } from 'express' 

export function startServer(appName: string, port: number) {
    const app = express()

    app.get('/', (req: Request, res: Response) => {
        res.send(appName)
    })

    app.listen(port, () => {
        console.log(chalk.green(`Application ${chalk.bold(appName)} started on port ${chalk.bold(port)}`))
    })
}
