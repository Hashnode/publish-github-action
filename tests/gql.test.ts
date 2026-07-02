import { describe, expect, it } from "vitest";
import { GqlClient, GqlError, MAX_BODY_BYTES } from "../src/gql";

describe("GqlClient payload guard", () => {
  it("rejects payloads over the API body limit without a network call", async () => {
    const client = new GqlClient({ endpoint: "http://unused.invalid", token: "t" });
    const hugeMarkdown = "x".repeat(MAX_BODY_BYTES + 1);
    await expect(
      client.request("mutation ($input: PublishPostInput!) { publishPost(input: $input) { post { id } } }", {
        input: { contentMarkdown: hugeMarkdown },
      })
    ).rejects.toThrow(/too large/);
  });
});

describe("GqlError", () => {
  it("flags the Pro-plan FORBIDDEN error", () => {
    const error = new GqlError(
      "Publication does not have an active Pro plan. Upgrade in your dashboard to access this via the API.",
      "FORBIDDEN"
    );
    expect(error.isProRequired).toBe(true);
  });

  it("does not flag other FORBIDDEN errors", () => {
    const error = new GqlError("You are not a member of this publication.", "FORBIDDEN");
    expect(error.isProRequired).toBe(false);
  });
});
