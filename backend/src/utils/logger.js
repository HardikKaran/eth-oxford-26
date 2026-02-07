import winston from "winston";
import config from "../config/index.js";

const logger = winston.createLogger({
  level: config.env === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
      const svc = service ? `[${service}]` : "";
      const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
      return `${timestamp} ${level.toUpperCase().padEnd(5)} ${svc} ${message}${extra}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/aidchain.log", maxsize: 10_000_000, maxFiles: 5 }),
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
  ],
});

export function createServiceLogger(service) {
  return logger.child({ service });
}

export default logger;
