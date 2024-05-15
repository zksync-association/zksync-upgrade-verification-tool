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
      expect(() => target().rpc()).to.throw();
    });

    it("returns a github client with no auth info", async () => {
      const githubClient = target().github();
      expect(await githubClient.auth()).to.eql({ type: "unauthenticated" });
    });

    it("cannot return the network", async () => {
      expect(() => target().network).to.throw();
    });

    it("cannot return ethscan key", async () => {
      expect(() => target().network).to.throw();
    });

    it("returns undefined for github api key", async () => {
      expect(target().githubApiKey).to.eql(undefined);
    });
  });

  describe("when github api key is set", () => {
    const target = () => {
      const env = new EnvBuilder();
      env.withGithubApiKey("sometoken");
      return env;
    };

    it("returns an autheticated github client", async () => {
      const githubClient = target().github();
      expect(await githubClient.auth()).to.eql({
        token: "sometoken",
        tokenType: "oauth",
        type: "token",
      });
    });
  });

  describe("when network ist set to mainnet", () => {
    const target = () => {
      const env = new EnvBuilder();
      env.withNetwork("mainnet");
      return env;
    };

    it("returns an rpc client pointing to public mainnet node", () => {
      const rpc = target().rpc();
      expect(rpc.rpcUrl()).to.eql("https://ethereum-rpc.publicnode.com");
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
      expect(rpc.baseUri).to.eql("https://api.etherscan.io/api");
    });
  });

  describe("when network ist set to sepolia", () => {
    const target = () => {
      const env = new EnvBuilder();
      env.withNetwork("sepolia");
      return env;
    };

    it("returns an rpc client pointing to sepolia public node", () => {
      const rpc = target().rpc();
      expect(rpc.rpcUrl()).to.eql("https://ethereum-sepolia-rpc.publicnode.com");
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
      expect(rpc.baseUri).to.eql("https://api-sepolia.etherscan.io/api");
    });
  });
});
