import { loadConfig } from './config.js';
import { AppDatabase } from './db/database.js';
import { assertSchemaReady } from './db/migrate.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new AppDatabase(config.databasePath);
  try {
    assertSchemaReady(db);
  } catch (error) {
    db.close();
    console.error(`[启动失败] ${(error as Error).message}`);
    process.exit(1);
  }

  const app = await buildApp({ db, config });
  const shutdown = async (signal: string) => {
    app.log.info(`收到 ${signal}，正在停止服务`);
    try {
      await app.close();
      db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`厂序已启动：http://${config.host}:${config.port}`);
    app.log.info(`健康检查：http://${config.host}:${config.port}/api/v1/health`);
    app.log.info(`数据库：${config.databasePath}`);
  } catch (error) {
    app.log.error(error);
    db.close();
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`端口 ${config.port} 已被占用。请先停止占用进程或修改 .env 中的 PORT。`);
    }
    process.exit(1);
  }
}

void main();
