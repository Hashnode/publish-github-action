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

describe("GqlClient error bodies", () => {
  const withFetch = async (response: Response, run: () => Promise<void>) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => response) as typeof fetch;
    try {
      await run();
    } finally {
      globalThis.fetch = realFetch;
    }
  };

  it("surfaces the message of a GraphQL error returned with HTTP 400", async () => {
    const body = { errors: [{ message: 'Cannot query field "nope" on type "Query".', extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }] };
    await withFetch(new Response(JSON.stringify(body), { status: 400 }), async () => {
      const client = new GqlClient({ endpoint: "https://gql.example.com", token: "t" });
      await expect(client.request("{ nope }", {})).rejects.toMatchObject({
        code: "GRAPHQL_VALIDATION_FAILED",
        message: expect.stringContaining("Cannot query field"),
      });
    });
  });

  it("falls back to the HTTP status when the body has no GraphQL error", async () => {
    await withFetch(new Response("<html>bad gateway</html>", { status: 502 }), async () => {
      const client = new GqlClient({ endpoint: "https://gql.example.com", token: "t" });
      await expect(client.request("{ me { id } }", {})).rejects.toThrow(/HTTP 502/);
    });
  });
});
