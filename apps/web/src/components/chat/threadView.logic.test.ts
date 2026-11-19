import { describe, expect, it } from "vite-plus/test";

import {
  threadRouteSearchFromUrl,
  threadViewFromSearch,
  threadViewSearch,
} from "./threadView.logic";

describe("thread view search", () => {
  it("accepts only view=spec and drops anything else from the URL", () => {
    expect(threadRouteSearchFromUrl({ view: "spec" })).toEqual({ view: "spec" });
    expect(threadRouteSearchFromUrl({ view: "Spec" }).view).toBeUndefined();
    expect(threadRouteSearchFromUrl({ view: ["spec"] }).view).toBeUndefined();
    expect(threadRouteSearchFromUrl({}).view).toBeUndefined();
  });

  it("reads the view from an unvalidated location search", () => {
    expect(threadViewFromSearch({ view: "spec" })).toBe("spec");
    expect(threadViewFromSearch({ view: "other" })).toBe("thread");
    expect(threadViewFromSearch(undefined)).toBe("thread");
  });

  it("leaves the URL clean for the transcript", () => {
    expect(threadViewSearch("thread").view).toBeUndefined();
    expect(threadViewSearch("spec").view).toBe("spec");
  });
});
