import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

const parsePoolMin = () => {
  const parsed = Number.parseInt(process.env.DB_POOL_MIN || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
};

@Injectable()
export class DatabaseWarmupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseWarmupService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap() {
    if (this.dataSource.options.type === 'better-sqlite3') return;

    const connectionCount = parsePoolMin();
    const startedAt = Date.now();
    try {
      await Promise.all(
        Array.from({ length: connectionCount }, () =>
          this.dataSource.query('SELECT 1'),
        ),
      );
      this.logger.log(
        `Database pool warmed with ${connectionCount} connections in ${Date.now() - startedAt}ms`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Database pool warmup skipped: ${message}`);
    }
  }
}
