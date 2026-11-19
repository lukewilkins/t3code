import { describe, expect, it } from "vite-plus/test";

import { mapSpecLocalMedia, specLocalMediaPaths } from "./threadSpecMedia.ts";

describe("spec local media", () => {
  it("finds absolute media paths in images and media tags, skipping urls, docs and code", () => {
    const spec = [
      "![a](/tmp/a.png)",
      '![b](</tmp/with space/b.webm> "title") and <video controls src="/tmp/c.mp4"></video>',
      "![d](file:///tmp/d%20e.jpg)",
      "![url](https://example.com/x.png) ![rel](docs/x.png) ![doc](/tmp/notes.md)",
      "```md",
      "![fenced](/tmp/fenced.png)",
      "```",
    ].join("\n");
    expect(specLocalMediaPaths(spec)).toEqual([
      "/tmp/a.png",
      "/tmp/with space/b.webm",
      "/tmp/c.mp4",
      "/tmp/d e.jpg",
    ]);
  });

  it("rewrites only the paths it is given, keeping titles and fragments", () => {
    const copies = new Map([
      ["/tmp/a.png", "/state/attachments/a.png"],
      ["/tmp/b.png", "/state/T3 Home/b.png"],
    ]);
    expect(
      mapSpecLocalMedia(
        '![a](/tmp/a.png#w=200 "A") ![b](/tmp/b.png) <img src="/tmp/a.png"> ![c](/tmp/c.png)',
        (path) => copies.get(path),
      ),
    ).toBe(
      '![a](/state/attachments/a.png#w=200 "A") ![b](</state/T3 Home/b.png>) <img src="/state/attachments/a.png"> ![c](/tmp/c.png)',
    );
  });
});
