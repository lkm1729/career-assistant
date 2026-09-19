export class WriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private failures = new Set<string>();
  private pending = 0;
  constructor(private onChange: (state: { saving: boolean; failed: boolean }) => void = () => {}) {}
  enqueue(key: string, operation: () => Promise<unknown>) {
    this.pending += 1;
    this.notify();
    this.tail = this.tail
      .then(operation)
      .then(
        () => {
          this.failures.delete(key);
        },
        () => {
          this.failures.add(key);
        },
      )
      .then(() => {
        this.pending -= 1;
        this.notify();
      });
  }
  async flush(): Promise<boolean> {
    let observed: Promise<void>;
    do {
      observed = this.tail;
      await observed;
    } while (this.tail !== observed);
    return this.failures.size === 0;
  }
  private notify() {
    this.onChange({ saving: this.pending > 0, failed: this.failures.size > 0 });
  }
}
