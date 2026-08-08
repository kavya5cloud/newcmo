import { afterEach, describe, expect, it } from "vitest";
import { TokenKeyMismatchError, open, seal } from "@/lib/social/crypto";

// Production showed `dispatch_due_failed: "Unsupported state or unable to authenticate data"`
// and every slot then reported "the x account needs reconnecting" — which is true but hides
// why. That string is Node's generic GCM failure. The only thing that causes it here is a
// SOCIAL_TOKEN_KEY that changed after the tokens were sealed.

const withKey = (k: string | undefined, fn: () => void) => {
  const prev = process.env.SOCIAL_TOKEN_KEY;
  if (k === undefined) delete process.env.SOCIAL_TOKEN_KEY;
  else process.env.SOCIAL_TOKEN_KEY = k;
  try { fn(); } finally {
    if (prev === undefined) delete process.env.SOCIAL_TOKEN_KEY;
    else process.env.SOCIAL_TOKEN_KEY = prev;
  }
};

afterEach(() => { delete process.env.SOCIAL_TOKEN_KEY; });

describe("sealed tokens", () => {
  it("round-trips under one key", () => {
    withKey("key-a", () => expect(open(seal("secret-token"))).toBe("secret-token"));
  });

  it("names the cause when the key changed underneath it", () => {
    let sealed!: ReturnType<typeof seal>;
    withKey("key-a", () => { sealed = seal("secret-token"); });
    withKey("key-b", () => {
      expect(() => open(sealed)).toThrow(TokenKeyMismatchError);
      expect(() => open(sealed)).toThrow(/SOCIAL_TOKEN_KEY/);
    });
  });

  it("treats the dev fallback as its own key, which is the real-world trap", () => {
    // Connect an account with the variable unset, then set it. This is exactly the sequence
    // that broke production.
    let sealed!: ReturnType<typeof seal>;
    withKey(undefined, () => { sealed = seal("secret-token"); });
    withKey("finally-set-in-vercel", () => {
      expect(() => open(sealed)).toThrow(TokenKeyMismatchError);
    });
  });

  it("does not leak the ciphertext or the key in the message", () => {
    let sealed!: ReturnType<typeof seal>;
    withKey("key-a", () => { sealed = seal("secret-token"); });
    withKey("key-b", () => {
      try { open(sealed); } catch (e) {
        const msg = String((e as Error).message);
        expect(msg).not.toContain("key-b");
        expect(msg).not.toContain(sealed.ciphertext);
      }
    });
  });
});
