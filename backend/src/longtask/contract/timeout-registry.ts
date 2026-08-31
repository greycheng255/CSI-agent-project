/**
 * 平台侧自动超时注册表（纯逻辑，与存储解耦，便于单元测试）。
 * 每个自动超时都有唯一归属方（对接指南 §3.2.6"各管各的"）：
 * 平台只负责归 Marketplace 的 6 项计时，不代 Console 计时。
 */
export interface DueAction {
  readonly key: string;
  readonly dueAt: number;
  readonly meta?: unknown;
}

export class TimeoutRegistry {
  private readonly entries = new Map<string, DueAction>();

  /** 登记到期动作（同 key 覆盖，天然幂等） */
  set(key: string, dueAt: number, meta?: unknown): void {
    this.entries.set(key, { key, dueAt, meta });
  }

  get(key: string): DueAction | undefined {
    return this.entries.get(key);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  list(): DueAction[] {
    return [...this.entries.values()];
  }

  /** 扫描到期项：返回并移除所有 dueAt <= now 的动作；未到期项保留 */
  scanDue(now: number): DueAction[] {
    const due: DueAction[] = [];
    for (const entry of this.entries.values()) {
      if (entry.dueAt <= now) {
        due.push(entry);
        this.entries.delete(entry.key);
      }
    }
    return due;
  }
}