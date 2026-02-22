import { describe, it, expect } from "vitest";
import { Avala } from "../src/client.js";

describe("Avala client", () => {
  it("throws when no API key is provided", () => {
    const original = process.env.AVALA_API_KEY;
    delete process.env.AVALA_API_KEY;
    try {
      expect(() => new Avala()).toThrowError("No API key");
    } finally {
      if (original) process.env.AVALA_API_KEY = original;
    }
  });

  it("creates client with explicit API key", () => {
    const avala = new Avala({ apiKey: "test-key" });
    expect(avala.datasets).toBeDefined();
    expect(avala.projects).toBeDefined();
    expect(avala.exports).toBeDefined();
    expect(avala.tasks).toBeDefined();
  });
});
