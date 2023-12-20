import { mock} from "node:test";
import LockFactory, {Storage} from "../lock-operations.js";
import {PostgresDb} from "../db/pg.js";
import {LockAcquireObject} from "../db/db.js";
import { describe, it, beforeEach } from "mocha";
import { assert } from "chai";

describe("Lock Operation", () => {
  // Mock the pg class
  let lockId = "lock-test-comp";
  let owner = "owner1";
  let lock: LockAcquireObject = {
    lockId,
    owner: owner,
    expiryInSec: 10,
  };
  mock.method(PostgresDb.prototype, "format_nd_execute", async () => {
    return {
      rows: [
        {
          lock_id: lockId,
          owner: owner,
          expiration: new Date(),
        },
      ],
    };
  });
  mock.method(PostgresDb.prototype, "execute", async () => {
    return {
      rows: [
        {
          lock_id: lockId,
        },
      ],
    };
  });
  let storage: Storage;

  beforeEach(() => {
    storage = LockFactory.instantiate();
  });

  it("should store and result values", async () => {
    assert.deepStrictEqual(await storage.acquire(lock, new PostgresDb()), {
      lockId: "lock-test-comp",
      acquired: true,
    });
  });

  it("should release locks  ", async () => {
    lockId = "lock-test-comp2";
    assert.deepStrictEqual(await storage.release([lockId], new PostgresDb()), [
      lockId,
    ]);
  });
  it("should keep alive the existing locks ", async () => {
    assert.deepStrictEqual(
      await storage.keepAlive({lockIds: [lockId], owner: owner}, new PostgresDb()),
      [lockId]
    );
  });
});