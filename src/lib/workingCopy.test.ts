import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { WorkingCopy } from "./workingCopy";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("a completed save cannot mark newer edits as saved", async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  invoke.mockResolvedValueOnce({ content: "initial", version: "v0" });
  const copy = new WorkingCopy();
  await copy.load();
  invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  copy.edit("first");
  await vi.advanceTimersByTimeAsync(500);
  copy.edit("latest");
  await vi.advanceTimersByTimeAsync(500);
  first.resolve("v1");
  await vi.advanceTimersByTimeAsync(0);
  expect(copy.getSnapshot().content).toBe("latest");
  expect(copy.dirty).toBe(true);
  second.resolve("v2");
  await vi.advanceTimersByTimeAsync(0);
  expect(copy.dirty).toBe(false);
  expect(copy.getSnapshot().content).toBe("latest");
});

test("closing includes edits still waiting for autosave and preserves them on failure", async () => {
  invoke.mockResolvedValueOnce({ content: "initial", version: "v0" });
  const copy = new WorkingCopy();
  await copy.load();
  copy.edit("pending");
  const closing = deferred<{
    ended: boolean;
    version: string | null;
    error: { kind: string; message: string } | null;
  }>();
  invoke.mockReturnValueOnce(closing.promise);
  const result = copy.end("close");
  expect(copy.getSnapshot().phase).toBe("closing");
  expect(invoke).toHaveBeenLastCalledWith("end_note", {
    kind: "close",
    save: { content: "pending", version: "v0" },
  });
  copy.edit("too late");
  closing.resolve({
    ended: false,
    version: null,
    error: { kind: "io", message: "Access denied" },
  });
  await result;
  expect(copy.getSnapshot().phase).toBe("ready");
  expect(copy.getSnapshot().content).toBe("pending");
  expect(copy.dirty).toBe(true);
  invoke.mockResolvedValueOnce({ ended: true, version: "v1", error: null });
  await copy.end("close");
  expect(copy.getSnapshot().phase).toBe("ended");
  expect(copy.dirty).toBe(false);
  copy.edit("after close");
  expect(copy.getSnapshot().content).toBe("pending");
});

test("failed reads stay unavailable and external reads cannot replace intervening edits", async () => {
  invoke.mockRejectedValueOnce({ kind: "io", message: "Read failed" });
  const copy = new WorkingCopy();
  await copy.load();
  copy.edit("empty replacement");
  expect(copy.getSnapshot().content).toBeNull();
  expect(copy.getSnapshot().phase).toBe("loading");
  invoke.mockResolvedValueOnce({ content: "initial", version: "v0" });
  await copy.load();
  const reading = deferred<{ content: string; version: string }>();
  invoke.mockReturnValueOnce(reading.promise);
  const check = copy.checkExternal();
  copy.edit("local draft");
  reading.resolve({ content: "external", version: "v1" });
  await check;
  expect(copy.getSnapshot().content).toBe("local draft");
  expect(copy.getSnapshot().external?.content).toBe("external");
  invoke.mockResolvedValueOnce({ content: "newer external", version: "v2" });
  await copy.reloadExternal();
  expect(copy.getSnapshot().content).toBe("newer external");
  expect(copy.getSnapshot().external).toBeNull();
  expect(copy.dirty).toBe(false);
});

test("an uncertain deletion preserves the draft and never autosaves it before retry", async () => {
  invoke.mockResolvedValueOnce({ content: "initial", version: "v0" });
  const copy = new WorkingCopy();
  await copy.load();
  copy.edit("draft");
  invoke.mockRejectedValueOnce("Connection interrupted");
  await copy.end("delete");
  expect(copy.getSnapshot().phase).toBe("uncertain");
  copy.edit("late edit");
  await vi.advanceTimersByTimeAsync(1000);
  expect(copy.getSnapshot().content).toBe("draft");
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "read_note",
    "end_note",
  ]);
  invoke.mockResolvedValueOnce({ ended: true, version: null, error: null });
  await copy.retryEnd();
  expect(copy.getSnapshot().phase).toBe("ended");
  await vi.advanceTimersByTimeAsync(1000);
  expect(invoke).toHaveBeenLastCalledWith("end_note", {
    kind: "delete",
    save: null,
  });
});

test("exit saves the latest draft and an old cancellation cannot release a new exit", async () => {
  invoke.mockResolvedValueOnce({ content: "initial", version: "v0" });
  const copy = new WorkingCopy();
  await copy.load();
  const pending = deferred<string>();
  invoke.mockReturnValueOnce(pending.promise);
  copy.edit("first");
  await vi.advanceTimersByTimeAsync(500);
  copy.edit("latest");
  const exit = copy.prepareExit("first-exit");
  invoke.mockResolvedValueOnce("v2");
  pending.resolve("v1");
  expect(await exit).toBe(true);
  expect(invoke).toHaveBeenLastCalledWith("save_note", {
    content: "latest",
    version: "v1",
  });
  expect(copy.dirty).toBe(false);
  copy.cancelExit("first-exit");
  expect(copy.getSnapshot().phase).toBe("ready");
  expect(await copy.prepareExit("second-exit")).toBe(true);
  copy.cancelExit("first-exit");
  expect(copy.getSnapshot().phase).toBe("quitting");
  copy.cancelExit("second-exit");
  expect(copy.getSnapshot().phase).toBe("ready");
});

test("cancelling exit while an ending request is pending does not freeze the recovered draft", async () => {
  invoke.mockResolvedValueOnce({ content: "initial", version: "v0" });
  const copy = new WorkingCopy();
  await copy.load();
  copy.edit("draft");
  const ending = deferred<{
    ended: boolean;
    version: null;
    error: { kind: string; message: string };
  }>();
  invoke.mockReturnValueOnce(ending.promise);
  const close = copy.end("close");
  const exit = copy.prepareExit("cancelled");
  copy.cancelExit("cancelled");
  ending.resolve({
    ended: false,
    version: null,
    error: { kind: "io", message: "Application is closing" },
  });
  await close;
  expect(await exit).toBe(false);
  expect(copy.getSnapshot().phase).toBe("ready");
  expect(copy.getSnapshot().content).toBe("draft");
});
