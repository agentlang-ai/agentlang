import { isNodeEnv } from '../utils/runtime.js';
import { AppConfig } from './state.js';

let DailyRotateFile: any;
let winston: any;

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

function getLogLevel(): string {
  if (isNodeEnv && process.env && process.env.DEBUG) {
    return 'debug';
  }
  return AppConfig?.logging?.level || 'info';
}

export function initializeLogger() {
  const logLevel = getLogLevel();

  if (isNodeEnv) {
    const fileTransport = new DailyRotateFile({
      level: logLevel,
      filename: 'logs/app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '7d',
    });

    // Add console transport for visibility
    const consoleTransport = new winston.transports.Console({
      level: logLevel,
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message }: any) => {
          return `${level}: ${message}`;
        })
      ),
    });

    logger = winston.createLogger({
      level: logLevel,
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
        console.log(`${tag}: ${msg}`);
      };
    }
    logger = {
      debug: mkLogger('DEBUG'),
      info: mkLogger('INFO'),
      warn: mkLogger('WARN'),
      error: mkLogger('ERROR'),
    };
  }
}

initializeLogger();

export function updateLoggerFromConfig() {
  if (isNodeEnv && logger) {
    const logLevel = getLogLevel();
    logger.level = logLevel;
    if (logger.transports && logger.transports.length > 0) {
      logger.transports[0].level = logLevel;
    }
  }
}
