import type { UsageStats } from './provider/index.js';

export class BudgetExceededError extends Error {
  constructor(
    message: string,
    public readonly spentUsd: number,
    public readonly budgetUsd: number,
  ) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export class BudgetGovernor {
  private spentUsd = 0;
  private totalUsage: UsageStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  constructor(public readonly budgetUsd: number) {}

  record(costUsd: number, usage: UsageStats): void {
    this.spentUsd += costUsd;
    this.totalUsage.promptTokens += usage.promptTokens;
    this.totalUsage.completionTokens += usage.completionTokens;
    this.totalUsage.totalTokens += usage.totalTokens;
  }

  remainingUsd(): number {
    return Math.max(0, this.budgetUsd - this.spentUsd);
  }

  getSpentUsd(): number {
    return this.spentUsd;
  }

  getUsage(): UsageStats {
    return { ...this.totalUsage };
  }

  assertWithinBudget(): void {
    if (this.spentUsd > this.budgetUsd) {
      throw new BudgetExceededError(
        `Budget exceeded: $${this.spentUsd.toFixed(4)} / $${this.budgetUsd.toFixed(2)}`,
        this.spentUsd,
        this.budgetUsd,
      );
    }
  }

  isNearLimit(threshold = 0.85): boolean {
    if (this.budgetUsd <= 0) return false;
    return this.spentUsd / this.budgetUsd >= threshold;
  }
}
