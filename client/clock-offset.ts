/** NTP-lite. Client clocks are routinely wrong by seconds; every position we project
 *  depends on agreeing with the server about "now", so we measure the difference
 *  rather than trusting Date.now(). */

type Sample = { rtt: number; offset: number }

export class OffsetEstimator {
  private samples: Sample[] = []

  constructor(private readonly window = 5) {}

  /** @param t0 local clock when the ping was sent
   *  @param tServer server clock as reported in the pong
   *  @param t1 local clock when the pong arrived */
  sample(t0: number, tServer: number, t1: number): void {
    const rtt = t1 - t0
    this.samples.push({ rtt, offset: tServer + rtt / 2 - t1 })
    if (this.samples.length > this.window) this.samples.shift()
  }

  private get best(): Sample | undefined {
    // The lowest-RTT sample is the one least distorted by queueing in either direction.
    return this.samples.reduce<Sample | undefined>(
      (best, s) => (best === undefined || s.rtt < best.rtt ? s : best),
      undefined,
    )
  }

  get offset(): number {
    return this.best?.offset ?? 0
  }

  get rtt(): number {
    return this.best?.rtt ?? 0
  }

  toServer(localNow: number): number {
    return localNow + this.offset
  }
}
