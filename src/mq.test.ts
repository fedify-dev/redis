import { assertEquals } from "@std/assert/assert-equals";
import { assertGreater } from "@std/assert/assert-greater";
import { delay } from "@std/async/delay";
import { Redis } from "ioredis";
import { RedisMessageQueue } from "./mq.ts";

Deno.test("RedisMessageQueue", async (t) => {
  const channelKey = `fedify_test_channel_${crypto.randomUUID()}`;
  const queueKey = `fedify_test_queue_${crypto.randomUUID()}`;
  const lockKey = `fedify_test_lock_${crypto.randomUUID()}`;
  const mq = new RedisMessageQueue(() => new Redis(), {
    pollInterval: { seconds: 1 },
    channelKey,
    queueKey,
    lockKey,
  });
  const mq2 = new RedisMessageQueue(() => new Redis(), {
    pollInterval: { seconds: 1 },
    channelKey,
    queueKey,
    lockKey,
  });

  const messages: (string | number)[] = [];
  const controller = new AbortController();
  const listening = mq.listen((message: string | number) => {
    messages.push(message);
  }, controller);
  const listening2 = mq2.listen((message: string | number) => {
    messages.push(message);
  }, controller);

  await t.step("enqueue()", async () => {
    await mq.enqueue("Hello, world!");
  });

  await waitFor(() => messages.length > 0, 15_000);

  await t.step("listen()", () => {
    assertEquals(messages, ["Hello, world!"]);
  });

  let started = 0;
  await t.step("enqueue() with delay", async () => {
    started = Date.now();
    await mq.enqueue(
      "Delayed message",
      { delay: Temporal.Duration.from({ seconds: 3 }) },
    );
  });

  await waitFor(() => messages.length > 1, 15_000);

  await t.step("listen() with delay", () => {
    assertEquals(messages, ["Hello, world!", "Delayed message"]);
    assertGreater(Date.now() - started, 3_000);
  });

  await t.step("enqueue() [bulk]", async () => {
    for (let i = 0; i < 1_000; i++) await mq.enqueue(i);
  });

  await waitFor(() => messages.length > 1_001, 30_000);

  await t.step("listen() [bulk]", () => {
    const numbers: Set<number> = new Set();
    for (let i = 0; i < 1_000; i++) numbers.add(i);
    assertEquals(new Set(messages.slice(2)), numbers);
  });

  // Reset messages array for the next test:
  while (messages.length > 0) messages.pop();

  await t.step("enqueueMany()", async () => {
    const bulkMessages = Array.from({ length: 500 }, (_, i) => `bulk-${i}`);
    await mq.enqueueMany(bulkMessages);
  });

  await waitFor(() => messages.length >= 500, 30_000);

  await t.step("listen() after enqueueMany()", () => {
    const expectedMessages = new Set(
      Array.from({ length: 500 }, (_, i) => `bulk-${i}`),
    );
    assertEquals(new Set(messages), expectedMessages);
  });

  controller.abort();
  await listening;
  await listening2;

  mq[Symbol.dispose]();
  mq2[Symbol.dispose]();
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    await delay(500);
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timeout");
    }
  }
}
