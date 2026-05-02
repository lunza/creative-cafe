export type TestStatus = 'idle' | 'running' | 'completed' | 'failed';

export type TestResultStatus = 'pass' | 'fail' | 'skip';

export interface TestCase {
  id: string;
  name: string;
  description: string;
  fn: () => Promise<{ status: TestResultStatus; detail: string; duration: number }>;
}

export interface TestResult {
  id: string;
  name: string;
  status: TestResultStatus;
  detail: string;
  duration: number;
}

export interface TestReport {
  id?: string;
  name?: string;
  status?: TestResultStatus;
  startTime: number;
  endTime: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: TestResult[];
  totalDuration: number;
}

export interface TestLog {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}
