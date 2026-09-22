// The gql server rejects JSON bodies over 100 KB (express.json limit).
// Leave headroom for encoding overhead.
export const MAX_BODY_BYTES = 95_000;

export class GqlError extends Error {
  readonly code?: string;
  readonly isProRequired: boolean;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
    this.isProRequired =
      code === "FORBIDDEN" && /pro plan/i.test(message);
  }
}

export interface GqlClientOptions {
  endpoint: string;
  token: string;
}

export interface GqlRequester {
  request<T>(query: string, variables: Record<string, unknown>): Promise<T>;
}

export class GqlClient implements GqlRequester {
  private readonly endpoint: string;
  private readonly token: string;

  constructor(options: GqlClientOptions) {
    this.endpoint = options.endpoint;
    this.token = options.token;
  }

  async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const body = JSON.stringify({ query, variables });
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      throw new GqlError(
        `Request payload exceeds the API limit of ~100 KB. The post is too large to publish via the API.`,
        "PAYLOAD_TOO_LARGE"
      );
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body,
    });

    if (!response.ok) {
      throw new GqlError(`API request failed with HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
    };

    if (payload.errors?.length) {
      const first = payload.errors[0];
      throw new GqlError(first.message, first.extensions?.code);
    }
    if (!payload.data) {
      throw new GqlError("API returned an empty response.");
    }
    return payload.data;
  }
}

export const QUERIES = {
  publicationById: `query ($id: ObjectId!) { publication(id: $id) { id url } }`,
  publicationByHost: `query ($host: String!) { publication(host: $host) { id url } }`,
  postBySlug: `query ($id: ObjectId!, $slug: String!) {
    publication(id: $id) { post(slug: $slug) { id slug url } }
  }`,
  seriesBySlug: `query ($id: ObjectId!, $slug: String!) {
    publication(id: $id) { series(slug: $slug) { id } }
  }`,
  userByUsername: `query ($username: String!) { user(username: $username) { id } }`,
};

export const MUTATIONS = {
  publishPost: `mutation ($input: PublishPostInput!) {
    publishPost(input: $input) { post { id slug url } }
  }`,
  updatePost: `mutation ($input: UpdatePostInput!) {
    updatePost(input: $input) { post { id slug url } }
  }`,
  createDraft: `mutation ($input: CreateDraftInput!) {
    createDraft(input: $input) { draft { id slug } }
  }`,
  createImageUploadURL: `mutation ($input: CreateImageUploadInput!) {
    createImageUploadURL(input: $input) {
      presignedPut { url cdnUrl key }
    }
  }`,
  confirmImageUpload: `mutation ($input: ConfirmImageUploadInput!) {
    confirmImageUpload(input: $input) { ok cdnUrl }
  }`,
};
