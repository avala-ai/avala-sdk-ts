import { describe, expect, it } from "vitest";
import { collectRestMetadata } from "../scripts/tool-inventory-metadata.js";

describe("collectRestMetadata", () => {
  it("keeps every composite method and route paired in declaration order", () => {
    expect(
      collectRestMetadata({
        "avala.ai/rest-routes": [
          "fleet-device-list",
          "fleet-alert-list",
          "fleet-recording-list",
        ],
        "avala.ai/rest-methods": ["GET", "GET", "GET"],
      }),
    ).toEqual({
      restRoute:
        "fleet-device-list, fleet-alert-list, fleet-recording-list",
      restMethod: "GET, GET, GET",
      restUpstream:
        "GET fleet-device-list, GET fleet-alert-list, GET fleet-recording-list",
    });
  });

  it("keeps the singular catalog metadata shape", () => {
    expect(
      collectRestMetadata({
        "avala.ai/rest-route": "dataset-list",
        "avala.ai/rest-method": "GET",
      }),
    ).toEqual({
      restRoute: "dataset-list",
      restMethod: "GET",
      restUpstream: "GET dataset-list",
    });
  });
});
