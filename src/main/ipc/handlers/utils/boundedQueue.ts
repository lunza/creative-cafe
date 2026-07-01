/**
 * 有界异步队列 - 生产者/消费者之间的背压控制工具
 *
 * 用于流式转发场景：网络读取（生产者）和 IPC 发送（消费者）之间。
 * 当消费者（renderer 处理 IPC 消息）速度跟不上生产者（reader.read()）时，
 * 避免无界缓冲导致的内存堆积。
 *
 * 工作原理：
 * - 队列有硬上限 maxSize（防止极端情况下内存爆炸）
 * - 当 size >= highWaterMark 时，push() 会等待（背压）
 * - 当 size <= lowWaterMark 时，唤醒等待的 push()
 * - 消费者通过 drain() 取出当前所有积压元素
 *
 * 注意：本队列仅做生产者侧背压。消费者侧的发送频率由调度器
 * （如 setImmediate）控制，确保 IPC 不会一次性发送过多消息。
 */

export interface BoundedQueueOptions {
  /** 队列最大容量（硬上限，防御性保护） */
  maxSize: number;
  /** 高水位：size >= 此值时开始对生产者施加背压 */
  highWaterMark: number;
  /** 低水位：size <= 此值时唤醒被阻塞的生产者 */
  lowWaterMark: number;
}

export class BoundedQueue<T> {
  private buffer: T[] = [];
  private readonly maxSize: number;
  private readonly highWaterMark: number;
  private readonly lowWaterMark: number;
  /** 等待 push 的生产者回调队列 */
  private waiters: Array<() => void> = [];
  /** 当前是否处于背压暂停状态 */
  private paused = false;

  constructor(options: BoundedQueueOptions) {
    if (options.highWaterMark > options.maxSize) {
      throw new Error(
        `BoundedQueue: highWaterMark (${options.highWaterMark}) 不能大于 maxSize (${options.maxSize})`
      );
    }
    if (options.lowWaterMark > options.highWaterMark) {
      throw new Error(
        `BoundedQueue: lowWaterMark (${options.lowWaterMark}) 不能大于 highWaterMark (${options.highWaterMark})`
      );
    }
    this.maxSize = options.maxSize;
    this.highWaterMark = options.highWaterMark;
    this.lowWaterMark = options.lowWaterMark;
  }

  /** 当前队列长度 */
  get size(): number {
    return this.buffer.length;
  }

  /** 当前是否对生产者施加背压 */
  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * 入队一个元素。
   *
   * - 若已触发背压（size >= highWaterMark），则 await 直到消费者 drain 后唤醒
   * - 入队后若 size >= highWaterMark，标记为 paused，后续 push 会等待
   * - 硬上限保护：size >= maxSize 时强制 paused
   *
   * @param item 待入队元素
   */
  async push(item: T): Promise<void> {
    // 若处于背压状态，等待被唤醒
    while (this.paused) {
      await new Promise<void>(resolve => {
        this.waiters.push(resolve);
      });
    }

    this.buffer.push(item);

    // 触发高水位 -> 标记暂停，后续 push 将等待
    if (this.buffer.length >= this.highWaterMark) {
      this.paused = true;
    }

    // 硬上限保护（理论上 highWaterMark <= maxSize，此处为防御性兜底）
    if (this.buffer.length >= this.maxSize) {
      this.paused = true;
    }
  }

  /**
   * 取出当前所有积压元素。
   *
   * 取出后若 size <= lowWaterMark，唤醒所有等待的生产者。
   *
   * @returns 当前队列中的所有元素数组（可能为空）
   */
  drain(): T[] {
    const items = this.buffer;
    this.buffer = [];

    // 检查是否可以解除背压
    if (this.paused && this.buffer.length <= this.lowWaterMark) {
      this.paused = false;
      // 唤醒所有等待的生产者
      const toWake = this.waiters;
      this.waiters = [];
      for (const resolve of toWake) {
        resolve();
      }
    }

    return items;
  }

  /**
   * 等待直到队列解除背压状态。
   *
   * 适用于生产者在不入队的情况下主动等待消费者追赶。
   */
  async waitWhilePaused(): Promise<void> {
    while (this.paused) {
      await new Promise<void>(resolve => {
        this.waiters.push(resolve);
      });
    }
  }

  /**
   * 丢弃队列中所有剩余元素，并唤醒所有等待的生产者。
   *
   * 用于流式连接异常终止时清理状态，避免生产者永远 await。
   */
  dispose(): void {
    this.buffer = [];
    this.paused = false;
    const toWake = this.waiters;
    this.waiters = [];
    for (const resolve of toWake) {
      resolve();
    }
  }
}

export default BoundedQueue;
