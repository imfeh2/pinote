import { invoke } from "@tauri-apps/api/core";

export interface FileSnapshot {
  content: string;
  version: string;
}

export type DocumentIssue =
  | { kind: "ended" | "missing" }
  | { kind: "conflict"; snapshot: FileSnapshot }
  | { kind: "io" | "unknown"; message: string };

export interface EndResult {
  ended: boolean;
  version: string | null;
  error: DocumentIssue | null;
}

export interface WorkingCopySnapshot {
  phase:
    | "loading"
    | "ready"
    | "closing"
    | "deleting"
    | "quitting"
    | "uncertain"
    | "ended";
  content: string | null;
  external: FileSnapshot | null;
  error: DocumentIssue | null;
  reload: number;
}

function issue(error: unknown): DocumentIssue {
  if (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    ["ended", "missing", "conflict", "io"].includes(String(error.kind))
  ) {
    return error as DocumentIssue;
  }
  return { kind: "unknown", message: String(error) };
}

export class WorkingCopy {
  private snapshot: WorkingCopySnapshot = {
    phase: "loading",
    content: null,
    external: null,
    error: null,
    reload: 0,
  };
  private saved: FileSnapshot | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<boolean> | null = null;
  private loading: Promise<void> | null = null;
  private revision = 0;
  private exitAttempt: string | null = null;
  private endRequest: { kind: "close" | "delete"; discard: boolean } | null =
    null;
  private ending: Promise<EndResult | undefined> | null = null;

  get hasEndRequest() {
    return this.endRequest !== null;
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get dirty() {
    return (
      this.snapshot.content !== null &&
      this.snapshot.content !== this.saved?.content
    );
  }

  private update(change: Partial<WorkingCopySnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }

  private stopTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    this.stopTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save();
    }, 500);
  }

  private apply(snapshot: FileSnapshot) {
    this.saved = snapshot;
    this.revision += 1;
    this.update({
      content: snapshot.content,
      phase: "ready",
      external: null,
      error: null,
      reload: this.snapshot.reload + 1,
    });
  }

  load() {
    if (this.loading) return this.loading;
    if (this.snapshot.phase !== "loading") return Promise.resolve();
    this.loading = invoke<FileSnapshot>("read_note")
      .then((snapshot) => {
        if (this.snapshot.phase === "loading") this.apply(snapshot);
      })
      .catch((error: unknown) => {
        if (this.snapshot.phase !== "loading") return;
        const failure = issue(error);
        this.update({
          error: failure,
          phase:
            failure.kind === "ended"
              ? "ended"
              : this.saved
                ? "ready"
                : "loading",
        });
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  edit(content: string) {
    if (this.snapshot.phase !== "ready" || content === this.snapshot.content)
      return;
    this.endRequest = null;
    this.revision += 1;
    this.update({ content });
    this.schedule();
  }

  save(): Promise<boolean> {
    if (this.saving) return this.saving;
    if (this.snapshot.phase !== "ready" && this.snapshot.phase !== "quitting")
      return Promise.resolve(false);
    if (this.snapshot.external) return Promise.resolve(false);
    if (!this.dirty || !this.saved || this.snapshot.content === null)
      return Promise.resolve(true);
    const content = this.snapshot.content;
    this.saving = invoke<string>("save_note", {
      content,
      version: this.saved.version,
    })
      .then((version) => {
        this.saved = { content, version };
        if (this.snapshot.phase !== "ended") this.update({ error: null });
        return true;
      })
      .catch((error: unknown) => {
        const failure = issue(error);
        if (this.snapshot.phase !== "ended") {
          this.update({
            error: failure,
            ...(failure.kind === "conflict"
              ? { external: failure.snapshot }
              : {}),
          });
          if (failure.kind === "ended") this.markEnded();
        }
        return false;
      })
      .then((success) => {
        this.saving = null;
        if (
          success &&
          this.snapshot.phase === "ready" &&
          this.timer === null &&
          this.dirty
        )
          void this.save();
        return success;
      });
    return this.saving;
  }

  async checkExternal(): Promise<boolean> {
    if (this.snapshot.phase !== "ready") return false;
    while (this.saving) await this.saving;
    if (this.snapshot.phase !== "ready") return false;
    const revision = this.revision;
    try {
      const snapshot = await invoke<FileSnapshot>("read_note");
      if (this.snapshot.phase !== "ready") return false;
      if (this.saving) return this.checkExternal();
      if (snapshot.content === this.snapshot.content) {
        this.saved = snapshot;
        this.update({ external: null });
      } else if (snapshot.content !== this.saved?.content) {
        if (this.dirty || revision !== this.revision)
          this.update({ external: snapshot });
        else this.apply(snapshot);
      } else if (this.snapshot.external) {
        this.update({ external: null, error: null });
        if (this.dirty) this.schedule();
      }
      return true;
    } catch (error) {
      if (this.snapshot.phase !== "ready") return false;
      const failure = issue(error);
      this.update({ error: failure });
      if (failure.kind === "ended") this.markEnded();
      return false;
    }
  }

  async reloadExternal() {
    if (this.snapshot.phase !== "ready" || !this.snapshot.external) return;
    this.stopTimer();
    this.update({ phase: "loading" });
    if (this.saving) await this.saving;
    await this.load();
  }

  async keepCurrent() {
    while (this.saving) await this.saving;
    if (this.snapshot.phase !== "ready" || !this.snapshot.external) return;
    this.saved = this.snapshot.external;
    this.update({ external: null, error: null });
    this.schedule();
  }

  end(
    kind: "close" | "delete",
    discard = false,
  ): Promise<EndResult | undefined> {
    if (this.ending) return this.ending;
    if (["closing", "deleting", "quitting"].includes(this.snapshot.phase))
      return Promise.resolve(undefined);
    this.ending = this.performEnd(kind, discard).finally(() => {
      this.ending = null;
    });
    return this.ending;
  }

  private async performEnd(kind: "close" | "delete", discard: boolean) {
    const ended = this.snapshot.phase === "ended";
    this.endRequest = { kind, discard };
    this.stopTimer();
    this.update({
      phase: kind === "close" ? "closing" : "deleting",
      error: null,
    });
    if (this.saving) await this.saving;
    const content =
      !ended && kind === "close" && !discard && this.dirty
        ? this.snapshot.content
        : null;
    try {
      const result = await invoke<EndResult>("end_note", {
        kind,
        save:
          content !== null && this.saved
            ? { content, version: this.saved.version }
            : null,
      });
      if (content !== null && result.version !== null)
        this.saved = { content, version: result.version };
      if (ended || this.snapshot.phase === "ended") {
        this.markEnded();
        return { ...result, ended: true, error: this.snapshot.error };
      }
      this.update({
        phase: result.ended ? "ended" : this.saved ? "ready" : "loading",
        error: result.error,
        ...(result.error?.kind === "conflict"
          ? { external: result.error.snapshot }
          : {}),
      });
      if (!result.ended && kind === "delete" && this.dirty) this.schedule();
      return result;
    } catch (error) {
      const failure = issue(error);
      const knownEnded = ended || this.snapshot.phase === "ended";
      this.update({
        phase: knownEnded ? "ended" : "uncertain",
        error: failure,
      });
      return { ended: knownEnded, version: null, error: failure };
    }
  }

  retryEnd() {
    if (!this.endRequest) throw new Error("No document end operation to retry");
    return this.end(this.endRequest.kind, this.endRequest.discard);
  }

  dismissError() {
    if (this.snapshot.phase !== "ready") return;
    this.endRequest = null;
    this.update({ error: null });
    if (this.dirty && !this.snapshot.external) this.schedule();
  }

  markEnded(error?: DocumentIssue | null) {
    this.stopTimer();
    this.update({ phase: "ended", ...(error !== undefined ? { error } : {}) });
  }

  report(error: unknown) {
    if (this.snapshot.phase === "ended") return;
    const failure = issue(error);
    this.update({
      error: failure,
      ...(failure.kind === "conflict" ? { external: failure.snapshot } : {}),
    });
    if (failure.kind === "ended") this.markEnded();
  }

  async prepareExit(attempt: string): Promise<boolean> {
    this.exitAttempt = attempt;
    if (this.ending) await this.ending;
    if (this.exitAttempt !== attempt) return false;
    if (this.snapshot.phase === "ended") return true;
    if (
      this.snapshot.phase !== "ready" &&
      this.snapshot.phase !== "quitting" &&
      !(this.snapshot.phase === "loading" && this.snapshot.content === null)
    )
      return false;
    this.stopTimer();
    this.update({ phase: "quitting" });
    if (this.saving && !(await this.saving)) return false;
    return this.save();
  }

  cancelExit(attempt: string) {
    if (this.exitAttempt !== attempt) return;
    this.exitAttempt = null;
    if (this.snapshot.phase !== "quitting") return;
    this.update({ phase: this.saved ? "ready" : "loading" });
    if (!this.saved) void this.load();
  }

  disconnect() {
    this.stopTimer();
    if (this.snapshot.phase === "ready" && this.dirty) void this.save();
  }
}
