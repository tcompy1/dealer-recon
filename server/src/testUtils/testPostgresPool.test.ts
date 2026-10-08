import { EventEmitter } from "node:events";
import { expect, test, vi } from "vitest";
const { factory } = vi.hoisted(() => ({ factory: vi.fn() }));
vi.mock("../repositories/postgresTransactionRepository.js", () => ({ createPool: factory }));
import { createTestPool } from "./testPostgresPool.js";

test("end waits for actual client closure after native pool.end resolves", async () => {
  const native = new EventEmitter();
  const nativeEnd = vi.fn(async () => undefined);
  Object.assign(native, { end: nativeEnd });
  factory.mockReturnValue(native);
  const pool = createTestPool("synthetic-url");
  const first = new EventEmitter(), second = new EventEmitter();
  native.emit("connect", first); native.emit("connect", second);
  let completed = false;
  const closing = pool.end().then(() => { completed = true; });
  await new Promise(setImmediate);
  expect(nativeEnd).toHaveBeenCalledOnce();
  expect(completed).toBe(false);
  first.emit("end");
  await new Promise(setImmediate);
  expect(completed).toBe(false);
  second.emit("end");
  await closing;
  expect(completed).toBe(true);
});
