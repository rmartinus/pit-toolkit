
export interface DbConfig {
    user: String;
    host: String;
    database: String;
    password: String;
    port: number;
} 

export interface DbPoolConfig { 
    max: number;
    min: number;
    connectionTimeoutMillis: number;
    idleTimeoutMillis: number;
}

export interface DbPool {
    // connect(): Promise<Db>;
    // connect() : Promise<void>;
    disconnect(): Promise<void>;
}
  

export interface Db extends DbPool {
    release(): Promise<void>;
    execute( query: {
        name?: String;
        text: String;
        values: any // TODO fix type(String | Date)[]
      }): Promise<any>;
    format_nd_execute( query: {
        name?: String;
        text: String;
        values: any // TODO fix type(String | Date)[]
      }): Promise<any>;
}

 export type LockAcquireObject = {
    lockId: String;
    owner: String;
    expiryInSec?: number;
 }

 export type LockMetadata = {
        lock_owner: String;
        lock_expiry: Date;
        lock_created: Date;
 }


 export type LockManagerResponse = {
    lockId: String;
    acquired: boolean;
 }

  export type LockKeepAlive = {
      lockIds: Array<String>;
      owner: String;
      expiryInSec?: number;
  }