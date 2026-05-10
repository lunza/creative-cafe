import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('streamTimeoutGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('clearStreamTimeout does not shadow global clearTimeout', () => {
    it('should use the global clearTimeout function', () => {
      let streamTimeout: ReturnType<typeof setTimeout> | null = null;

      const clearStreamTimeout = () => {
        if (streamTimeout) {
          clearTimeout(streamTimeout);
          streamTimeout = null;
        }
      };

      const callback = vi.fn();
      streamTimeout = setTimeout(callback, 5000);

      clearStreamTimeout();
      vi.advanceTimersByTime(6000);

      expect(callback).not.toHaveBeenCalled();
      expect(streamTimeout).toBeNull();
    });

    it('should be safe to call clearStreamTimeout multiple times', () => {
      let streamTimeout: ReturnType<typeof setTimeout> | null = null;

      const clearStreamTimeout = () => {
        if (streamTimeout) {
          clearTimeout(streamTimeout);
          streamTimeout = null;
        }
      };

      const callback = vi.fn();
      streamTimeout = setTimeout(callback, 5000);

      clearStreamTimeout();
      clearStreamTimeout();
      clearStreamTimeout();

      vi.advanceTimersByTime(6000);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should do nothing when streamTimeout is already null', () => {
      let streamTimeout: ReturnType<typeof setTimeout> | null = null;

      const clearStreamTimeout = () => {
        if (streamTimeout) {
          clearTimeout(streamTimeout);
          streamTimeout = null;
        }
      };

      expect(() => clearStreamTimeout()).not.toThrow();
      expect(streamTimeout).toBeNull();
    });

    it('should not interfere with other unrelated timers', () => {
      let streamTimeout: ReturnType<typeof setTimeout> | null = null;

      const clearStreamTimeout = () => {
        if (streamTimeout) {
          clearTimeout(streamTimeout);
          streamTimeout = null;
        }
      };

      const unrelatedCallback = vi.fn();
      setTimeout(unrelatedCallback, 3000);

      streamTimeout = setTimeout(vi.fn(), 5000);
      clearStreamTimeout();

      vi.advanceTimersByTime(4000);

      expect(unrelatedCallback).toHaveBeenCalled();
    });
  });

  describe('dynamic timeout calculation based on max_tokens', () => {
    function calculateStreamTimeoutMs(maxTokens: number | undefined | string): number {
      return maxTokens && Number(maxTokens) > 8192 ? 300000 : 120000;
    }

    it('should use 120s timeout when max_tokens is undefined', () => {
      const timeoutMs = calculateStreamTimeoutMs(undefined);
      expect(timeoutMs).toBe(120000);
    });

    it('should use 120s timeout when max_tokens is 8192', () => {
      const timeoutMs = calculateStreamTimeoutMs(8192);
      expect(timeoutMs).toBe(120000);
    });

    it('should use 120s timeout when max_tokens is less than 8192', () => {
      expect(calculateStreamTimeoutMs(4096)).toBe(120000);
      expect(calculateStreamTimeoutMs(1024)).toBe(120000);
      expect(calculateStreamTimeoutMs(256)).toBe(120000);
    });

    it('should use 300s timeout when max_tokens is greater than 8192', () => {
      expect(calculateStreamTimeoutMs(8193)).toBe(300000);
      expect(calculateStreamTimeoutMs(16384)).toBe(300000);
      expect(calculateStreamTimeoutMs(32768)).toBe(300000);
    });

    it('should handle string max_tokens values', () => {
      expect(calculateStreamTimeoutMs('16384')).toBe(300000);
      expect(calculateStreamTimeoutMs('4096')).toBe(120000);
      expect(calculateStreamTimeoutMs('8192')).toBe(120000);
    });

    it('should handle numeric string comparison correctly', () => {
      expect(calculateStreamTimeoutMs('8193')).toBe(300000);
      expect(calculateStreamTimeoutMs('0')).toBe(120000);
    });

    it('should use 120s timeout for edge case exactly at 8192', () => {
      expect(calculateStreamTimeoutMs(8192)).toBe(120000);
      expect(calculateStreamTimeoutMs(8192.0)).toBe(120000);
    });

    it('should use 300s timeout for edge case just above 8192', () => {
      expect(calculateStreamTimeoutMs(8192.01)).toBe(300000);
      expect(calculateStreamTimeoutMs(8193)).toBe(300000);
    });
  });

  describe('timeout cleanup scenarios', () => {
    it('should clear timeout on complete', () => {
      let streamTimeout: ReturnType<typeof setTimeout> | null = null;
      const timeoutCallback = vi.fn();
      const onCompleteCallback = vi.fn();

      const clearStreamTimeout = () => {
        if (streamTimeout) {
          clearTimeout(streamTimeout);
          streamTimeout = null;
        }
      };

      const simulateComplete = () => {
        clearStreamTimeout();
        onCompleteCallback();
      };

      const streamTimeoutMs = 120000;
      streamTimeout = setTimeout(timeoutCallback, streamTimeoutMs);

      vi.advanceTimersByTime(30000);
      simulateComplete();
      vi.advanceTimersByTime(200000);

      expect(onCompleteCallback).toHaveBeenCalled();
      expect(timeoutCallback).not.toHaveBeenCalled();
    });

    it('should clear timeout on error', () => {
      let streamTimeout: ReturnType<typeof setTimeout> | null = null;
      const timeoutCallback = vi.fn();
      const onErrorCallback = vi.fn();

      const clearStreamTimeout = () => {
        if (streamTimeout) {
          clearTimeout(streamTimeout);
          streamTimeout = null;
        }
      };

      const simulateError = () => {
        clearStreamTimeout();
        onErrorCallback();
      };

      const streamTimeoutMs = 120000;
      streamTimeout = setTimeout(timeoutCallback, streamTimeoutMs);

      vi.advanceTimersByTime(60000);
      simulateError();
      vi.advanceTimersByTime(70000);

      expect(onErrorCallback).toHaveBeenCalled();
      expect(timeoutCallback).not.toHaveBeenCalled();
    });

    it('should fire timeout callback if no cleanup occurs within timeout period', () => {
      let streamTimeout: ReturnType<typeof setTimeout> | null = null;
      const timeoutCallback = vi.fn();

      const clearStreamTimeout = () => {
        if (streamTimeout) {
          clearTimeout(streamTimeout);
          streamTimeout = null;
        }
      };

      const streamTimeoutMs = 120000;
      streamTimeout = setTimeout(timeoutCallback, streamTimeoutMs);

      vi.advanceTimersByTime(120001);

      expect(timeoutCallback).toHaveBeenCalledTimes(1);
      clearStreamTimeout();
    });

    it('should handle rapid complete then error without double execution', () => {
      let streamTimeout: ReturnType<typeof setTimeout> | null = null;
      const timeoutCallback = vi.fn();
      const onCompleteCallback = vi.fn();
      const onErrorCallback = vi.fn();

      const clearStreamTimeout = () => {
        if (streamTimeout) {
          clearTimeout(streamTimeout);
          streamTimeout = null;
        }
      };

      const streamTimeoutMs = 120000;
      streamTimeout = setTimeout(timeoutCallback, streamTimeoutMs);

      vi.advanceTimersByTime(50000);
      clearStreamTimeout();
      onCompleteCallback();
      onErrorCallback();
      clearStreamTimeout();

      vi.advanceTimersByTime(200000);

      expect(onCompleteCallback).toHaveBeenCalledTimes(1);
      expect(onErrorCallback).toHaveBeenCalledTimes(1);
      expect(timeoutCallback).not.toHaveBeenCalled();
    });
  });
});
