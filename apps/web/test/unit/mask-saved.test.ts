import { maskSaved } from "@/utils/mask-saved";
import { describe, expect, it } from "vitest";

describe("maskSaved", () => {
  it("keeps an RPC URL's host and hides the rest but its last four characters", () => {
    expect(maskSaved("https://mainnet.infura.io/v3/0123456789abcdef", "url")).toBe(
      "https://mainnet.infura.io/••••••••cdef"
    );
    expect(maskSaved("https://user:pass@rpc.example/", "url")).toBe("https://rpc.example/••••••••");
    expect(maskSaved("https://eth.example/?key=abcdef123456", "url")).toBe(
      "https://eth.example/••••••••3456"
    );
  });

  it("shows a URL with nothing secret in it as it is", () => {
    expect(maskSaved("https://eth.example/", "url")).toBe("https://eth.example/");
  });

  it("hides a key but its last four characters, a short one entirely", () => {
    expect(maskSaved("eyJhbGciOiJIUzI1NiJ9.payload.sig1", "key")).toBe("••••••••sig1");
    expect(maskSaved("short-key", "key")).toBe("••••••••");
  });
});
