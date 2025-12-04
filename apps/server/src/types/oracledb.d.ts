declare module 'oracledb' {
  export const OUT_FORMAT_OBJECT: number;

  export interface ExecuteOptions {
    outFormat?: number;
  }

  export interface Pool {
    connectionsInUse: number;
    connectionsOpen: number;
    totalRequestsInQueue: number;
    totalRequestsRejected: number;
    totalRequestsSuccessful: number;
    totalRequestsTimedOut: number;
    close(timeout?: number): Promise<void>;
  }

  export function createPool(config: any): Promise<Pool>;
  export function getConnection(): Promise<any>;
  export function getPool(alias?: string): Pool;

  const oracledb: any;
  export default oracledb;
}