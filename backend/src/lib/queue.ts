// Concurrency queue - serialize RouterOS write operations
type Job<T> = () => Promise<T>;

class AsyncQueue {
  private chain: Promise<any> = Promise.resolve();
  private pending = 0;

  enqueue<T>(job: Job<T>): Promise<T> {
    const result = this.chain.then(() => job());
    this.chain = result.catch(() => {});
    this.pending++;
    result.finally(() => this.pending--);
    return result;
  }

  get size(): number { return this.pending; }
}

export const routerQueue = new AsyncQueue();