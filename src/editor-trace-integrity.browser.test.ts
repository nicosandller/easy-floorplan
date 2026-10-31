import { describe, expect, it } from "vitest";
import { fetchVerifiedPdfSource } from "./editor-trace";

// Exercise the browser's actual SRI implementation, rather than a mocked fetch.
const source = "export const verified = true;";
const integrity = "sha384-kd9twHOFsynk/n8G5ao78hM35tnh+vHU3cTsnqtGRzwXlho6da60/roJeQO70EDp";
const url = (text: string) => `data:text/javascript,${encodeURIComponent(text)}`;

describe("PDF source integrity", () => {
  it("returns the exact source when its SHA-384 matches", async () => {
    expect(await fetchVerifiedPdfSource(url(source), integrity)).toBe(source);
  });
  it("rejects changed source before it can be imported", async () => {
    await expect(fetchVerifiedPdfSource(url(source + " /* changed */"), integrity)).rejects.toThrow();
  });
});
