import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

/**
 * 日志配置选项
 */
interface LoggerOptions {
  agentId?: string;
  logDir?: string;
  level?: string;
  console?: boolean;
}

/**
 * 创建结构化日志记录器
 */
export function createLogger(options: LoggerOptions = {}): winston.Logger {
  const {
    agentId = 'unknown',
    logDir = './logs',
    level = process.env.LOG_LEVEL || 'info',
    console = true,
  } = options;

  const formats = [
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ];

  const transports: winston.transport[] = [];

  // 控制台输出（开发环境）
  if (console) {
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ level, message, timestamp, ...metadata }) => {
            let msg = `${timestamp} [${level}]: ${message}`;
            if (Object.keys(metadata).length > 0) {
              msg += ` ${JSON.stringify(metadata)}`;
            }
            return msg;
          })
        ),
      })
    );
  }

  // 文件输出 - 按日期轮转
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: winston.format.combine(...formats),
    })
  );

  // 错误日志单独文件
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error',
      format: winston.format.combine(...formats),
    })
  );

  const logger = winston.createLogger({
    level,
    defaultMeta: { agentId, service: 'genesis-agent' },
    transports,
    exitOnError: false,
  });

  // 添加事件日志方法
  logger.event = (event: string, message: string, payload?: Record<string, unknown>) => {
    logger.info(message, { event, ...payload });
  };

  return logger;
}

/**
 * 全局日志实例
 */
let globalLogger: winston.Logger | null = null;

/**
 * 初始化全局日志
 */
export function initLogger(options: LoggerOptions = {}): winston.Logger {
  globalLogger = createLogger(options);
  return globalLogger;
}

/**
 * 获取全局日志实例
 */
export function getLogger(): winston.Logger {
  if (!globalLogger) {
    globalLogger = createLogger();
  }
  return globalLogger;
}

// 扩展 winston.Logger 类型
declare module 'winston' {
  interface Logger {
    event(event: string, message: string, payload?: Record<string, unknown>): void;
  }
}

export default getLogger;
