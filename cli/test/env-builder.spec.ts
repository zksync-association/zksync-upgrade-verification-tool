import { describe, it, expect } from "vitest";
import { EnvBuilder } from "../src/lib/env-builder.js";

describe("EnvBuilder", () => {
  describe("when its empty", () => {
    const target = () => new EnvBuilder();
    it("cannot return a l1 explorer client", () => {
      expect(() => target().l1Client()).to.throw();
    });

    it("cannot return a l2 explorer client without a network specified", () => {
      expect(() => target().l2Client()).to.throw();
    });

    it("cannot return an rpc client", () => {
      expect(() => target().rpcL1()).to.throw();
    });

    it("returns an era contracts repo in main", async () => {
      const repo = await target().contractsRepo();
      const current = await repo.currentRef();
      expect(current).toEqual("main");
    });

    it("cannot return the network", async () => {
      expect(() => target().network).to.throw();
    });

    it("cannot return ethscan key", async () => {
      expect(() => target().network).to.throw();
    });
  });

  describe("when network ist set to mainnet", () => {
    const target = () => {
      const env = new EnvBuilder();
      env.withNetwork("mainnet");
      return env;
    };

    it("returns an rpc client pointing to public mainnet node", () => {
      const rpc = target().rpcL1();
      expect(rpc.rpcUrl()).toEqual("https://ethereum-rpc.publicnode.com");
    });
  });

  describe("when network ist set to mainnet and ethscan key is defined", () => {
    const target = () => {
      const env = new EnvBuilder();
      env.withNetwork("mainnet");
      env.withEtherscanApiKey("someethscankey");
      return env;
    };

    it("returns an rpc client pointing to public mainnet node", () => {
      const rpc = target().l1Client();
      expect(rpc.baseUri).toEqual("https://api.etherscan.io/api");
    });
  });

  describe("when network ist set to sepolia", () => {
    const target = () => {
      const env = new EnvBuilder();
      env.withNetwork("sepolia");
      return env;
    };

    it("returns an rpc client pointing to sepolia public node", () => {
      const rpc = target().rpcL1();
      expect(rpc.rpcUrl()).toEqual("https://ethereum-sepolia-rpc.publicnode.com");
    });
  });

  describe("when network is set to sepolia and the etherscan key is set", () => {
    const target = () => {
      const env = new EnvBuilder();
      env.withNetwork("sepolia");
      env.withEtherscanApiKey("someethscankey");
      return env;
    };

    it("returns an rpc client pointing to public mainnet node", () => {
      const rpc = target().l1Client();
      expect(rpc.baseUri).toEqual("https://api-sepolia.etherscan.io/api");
    });
  });

  describe("when ref is set", () => {
    it("returns an era contracts repo in that ref", async () => {
      const target = new EnvBuilder();
      const ref = "e77971dba8f589b625e72e69dd7e33ccbe697cc0";
      target.withRef(ref);
      const repo = await target.contractsRepo();
      const current = await repo.currentRef();
      expect(current).toEqual(ref);
    });
  });

  describe("colored", () => {
    it("is true by default", () => {
      const target = new EnvBuilder();
      expect(target.colored).toEqual(true);
    })

    it("is false after set to false", () => {
      const target = new EnvBuilder();
      target.withColored(false)
      expect(target.colored).toEqual(false);
    })

    it("is true after set to true", () => {
      const target = new EnvBuilder();
      target.withColored(true)
      expect(target.colored).toEqual(true);
    })
  })
});
