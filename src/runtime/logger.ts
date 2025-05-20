import { isNodeEnv } from '../utils/runtime.js';

let DailyRotateFile: any;
let winston: any

if (isNodeEnv) {
  // Only import Node.js modules in Node environment
  // Using dynamic imports to avoid breaking browser bundling
  await import('winston-daily-rotate-file').then(module => {
    DailyRotateFile = module.default;
  });
  await import('winston').then(module => {
    winston = module.default;
  });
}

export let logger: any;

if (isNodeEnv) {
  const fileTransport = new DailyRotateFile({
    level: 'debug',
    filename: 'logs/app-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '7d',
  });

  const consoleTransport = new winston.transports.Console();

  logger = winston.createLogger({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message }: any) => {
        return `[${timestamp}] ${level}: ${message}`;
      })
    ),
    transports: [fileTransport, consoleTransport],
  });
} else {
  function mkLogger(tag: string): Function {
    return (msg: string) => {
      console.log(`${tag}: ${msg}`)
    }
  }
  logger = {
    debug: mkLogger('DEBUG'),
    info: mkLogger('INFO'),
    warn: mkLogger('WARN'),
    error: mkLogger('ERROR')
  }
}
