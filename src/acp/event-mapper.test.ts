import { describe, expect, it } from "vitest";
import { inferToolKind } from "./event-mapper.js";

describe("inferToolKind", () => {
  it("returns 'other' for names that only contain 'read' as a substring", () => {
    expect(inferToolKind("thread")).toBe("other");
    expect(inferToolKind("spread")).toBe("other");
    expect(inferToolKind("thread_pool")).toBe("other");
  });

  it("returns 'read' for names with 'read' as a word-boundary token", () => {
    expect(inferToolKind("read_file")).toBe("read");
    expect(inferToolKind("file_read")).toBe("read");
    expect(inferToolKind("read")).toBe("read");
    expect(inferToolKind("file.read")).toBe("read");
    expect(inferToolKind("file-read")).toBe("read");
  });

  it("returns 'search' for search/find tokens", () => {
    expect(inferToolKind("search")).toBe("search");
    expect(inferToolKind("file_find")).toBe("search");
  });

  it("returns 'edit' for write/edit tokens", () => {
    expect(inferToolKind("write")).toBe("edit");
    expect(inferToolKind("file_edit")).toBe("edit");
  });

  it("returns 'execute' for exec/run/bash tokens", () => {
    expect(inferToolKind("bash")).toBe("execute");
    expect(inferToolKind("run_command")).toBe("execute");
  });

  it("returns 'fetch' for names containing fetch or http", () => {
    expect(inferToolKind("fetch_url")).toBe("fetch");
    expect(inferToolKind("http_request")).toBe("fetch");
  });

  it("returns 'other' for undefined or unrecognized names", () => {
    expect(inferToolKind(undefined)).toBe("other");
    expect(inferToolKind("foobar")).toBe("other");
  });
});
