/** Khóa đơn giản trong tiến trình: các thao tác ghi chạy lần lượt, không chồng nhau. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn)
    this.tail = result.catch(() => undefined)
    return result
  }
}
