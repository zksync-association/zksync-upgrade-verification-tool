import { parseFreezeParams, parseId, parseVetoParams } from "@/.server/params";
import { suppliedSignatures } from "@/.server/request";
import { describe, expect, it } from "vitest";

const id = `0x${"ab".repeat(32)}`;

describe("URL parameters", () => {
  it("accepts only 32-byte ids", () => {
    expect(parseId(id.toUpperCase().replace("0X", "0x"))).toBe(id);
    expect(() => parseId("0x1234")).toThrow();
    expect(() => parseId(undefined)).toThrow();
  });

  it("parses a freeze request URL and rejects incomplete ones", () => {
    const url = new URL("http://x/app/freeze/soft-freeze?nonce=0&validUntil=1790000000");
    expect(parseFreezeParams("soft-freeze", url)).toEqual({
      action: "SoftFreeze",
      nonce: "0",
      validUntil: "1790000000",
      threshold: undefined,
    });
    expect(() => parseFreezeParams("melt", url)).toThrow();
    expect(() => parseFreezeParams("set-soft-freeze-threshold", url)).toThrow();
    expect(
      parseFreezeParams("set-soft-freeze-threshold", new URL(`${url}&threshold=2`)).threshold
    ).toBe("2");
  });

  it("parses a veto URL with checksummed addresses", () => {
    const url = new URL(
      "http://x/?governor=0xb83ff6501214ddf40c91c9565d095400f3f45746&l2GasLimit=30000000&l2GasPerPubdataByteLimit=800&refundRecipient=0xf378708b88841abb63e2316e4fc8f29469bee885&txMintValue=1&nonce=0"
    );
    expect(parseVetoParams("42", url).l2GovernorAddress).toBe(
      "0xb83FF6501214ddF40C91C9565d095400f3F45746"
    );
    expect(() => parseVetoParams("0x2a", url)).toThrow();
  });

  it("reads ?sig=<member>:<signature> and skips malformed ones", () => {
    const request = new Request(
      "http://x/?sig=0x34ea62d4b9bbb8ad927efb6ab31e3ab3474ac93a:0xaabb&sig=nonsense&sig=0x34Ea62D4b9bBB8AD927eFB6ab31E3Ab3474aC93a:0xzz"
    );
    expect(suppliedSignatures(request)).toEqual([
      { signer: "0x34Ea62D4b9bBB8AD927eFB6ab31E3Ab3474aC93a", signature: "0xaabb" },
    ]);
  });
});
