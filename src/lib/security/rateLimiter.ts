class RateLimiter {
  private loginAttempts: number[] = [];
  private apiRequests: number[] = [];

  checkLogin(): boolean {
    const now = Date.now();
    // 10 minutes rolling window
    this.loginAttempts = this.loginAttempts.filter(t => now - t < 10 * 60 * 1000);
    if (this.loginAttempts.length >= 5) {
      return false; // Rate limit hit
    }
    this.loginAttempts.push(now);
    return true;
  }

  checkApi(): boolean {
    const now = Date.now();
    // 1 minute rolling window
    this.apiRequests = this.apiRequests.filter(t => now - t < 60 * 1000);
    if (this.apiRequests.length >= 60) {
      return false; // Rate limit hit
    }
    this.apiRequests.push(now);
    return true;
  }
}

export const rateLimiter = new RateLimiter();
