import DailyRotateFile from 'winston-daily-rotate-file';
import winston from 'winston';

const fileTransport = new DailyRotateFile({
  level: 'debug',
  filename: 'logs/app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '7d',
});

const consoleTransport = new winston.transports.Console();

export const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${level}: ${message}`;
    })
  ),
  transports: [fileTransport, consoleTransport],
});
