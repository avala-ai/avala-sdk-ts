import { describe, it, expect } from "vitest";
import {
  AvalaError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  ServerError,
} from "../src/errors.js";

describe("AvalaError", () => {
  it("stores message, statusCode, and body", () => {
    const err = new AvalaError("something broke", 500, { detail: "oops" });
    expect(err.message).toBe("something broke");
    expect(err.statusCode).toBe(500);
    expect(err.body).toEqual({ detail: "oops" });
    expect(err.name).toBe("AvalaError");
    expect(err).toBeInstanceOf(Error);
  });

  it("defaults statusCode and body to undefined", () => {
    const err = new AvalaError("bare error");
    expect(err.statusCode).toBeUndefined();
    expect(err.body).toBeUndefined();
  });
});

describe("AuthenticationError", () => {
  it("has statusCode 401 and correct name", () => {
    const err = new AuthenticationError("invalid key", { error: "unauthorized" });
    expect(err.statusCode).toBe(401);
    expect(err.name).toBe("AuthenticationError");
    expect(err.body).toEqual({ error: "unauthorized" });
    expect(err).toBeInstanceOf(AvalaError);
  });
});

describe("NotFoundError", () => {
  it("has statusCode 404 and correct name", () => {
    const err = new NotFoundError("not found");
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe("NotFoundError");
    expect(err).toBeInstanceOf(AvalaError);
  });
});

describe("RateLimitError", () => {
  it("has statusCode 429, retryAfter, and correct name", () => {
    const err = new RateLimitError("rate limited", { detail: "slow down" }, 30);
    expect(err.statusCode).toBe(429);
    expect(err.name).toBe("RateLimitError");
    expect(err.retryAfter).toBe(30);
    expect(err).toBeInstanceOf(AvalaError);
  });

  it("defaults retryAfter to null", () => {
    const err = new RateLimitError("rate limited");
    expect(err.retryAfter).toBeNull();
  });
});

describe("ValidationError", () => {
  it("has configurable statusCode, details, and correct name", () => {
    const err = new ValidationError("bad input", 422, { fields: ["name"] }, [{ field: "name", error: "required" }]);
    expect(err.statusCode).toBe(422);
    expect(err.name).toBe("ValidationError");
    expect(err.details).toEqual([{ field: "name", error: "required" }]);
    expect(err).toBeInstanceOf(AvalaError);
  });
});

describe("ServerError", () => {
  it("stores the statusCode and has correct name", () => {
    const err = new ServerError("internal error", 503, { detail: "service unavailable" });
    expect(err.statusCode).toBe(503);
    expect(err.name).toBe("ServerError");
    expect(err.body).toEqual({ detail: "service unavailable" });
    expect(err).toBeInstanceOf(AvalaError);
  });
});
