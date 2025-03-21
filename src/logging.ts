export interface Logger {
  log: (message: string, ...data: any) => void;
  error: (message: string, ...data: any) => void;
}
