import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { GitContractsRepo } from "../src/reports/git-contracts-repo";
import { ContractData } from "../src/ethereum/contract-data";

const MIT_CONTENT = `MIT License

Copyright (c) 2019 Matter Labs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

describe("EraContractsRepo", () => {
  describe.skip("after compile for commit (a1a05513c110586f7a1d8b5fa46115cc7307587a)", () => {
    let contractsRepo: GitContractsRepo;

    beforeAll(async () => {
      await fs.mkdir("/tmp/era-contract-repo-test", { recursive: true });
      contractsRepo = new GitContractsRepo("/tmp/era-contract-repo-test");
      await contractsRepo.init();
      await contractsRepo.setRevision("a1a05513c110586f7a1d8b5fa46115cc7307587a");
      await contractsRepo.compileSystemContracts();
    }, 90000);

    it("gets right hashcode for every contract", async () => {
      const contracts = [
        {
          contractName: "AccountCodeStorage",
          bytecodeHash: "0x0100007545573b787fcb5e59e1744a3f0587699c7174fb22fa287f9947f1400c",
        },
        {
          contractName: "BootloaderUtilities",
          bytecodeHash: "0x010007d1c6b5dd244ae63e4fa219d75aefc7516b94bc60071315f512a4dd8d97",
        },
        {
          contractName: "ComplexUpgrader",
          bytecodeHash: "0x0100005535644003030026183be2c9a360ea75f25e9258059c667ae732cc9d8d",
        },
        {
          contractName: "Compressor",
          bytecodeHash: "0x0100016f82aaa974f06ffca704567788945eeb205f7fe4de61162c97d1434876",
        },
        {
          contractName: "ContractDeployer",
          bytecodeHash: "0x01000521106ae713e577abe15045de9a31a6006f43f0a432a17cf604acd0c880",
        },
        {
          contractName: "DefaultAccount",
          bytecodeHash: "0x01000563ee5d0abdf9fc65f748a700d2c377aadebc16d5bf21105f8a94eff028",
        },
        {
          contractName: "EmptyContract",
          bytecodeHash: "0x010000072fe700c98bf6cf17626307bbd796f9c0a70dd843ca59bdde56d4c356",
        },
        {
          contractName: "GasBoundCaller",
          bytecodeHash: "0x010000b598ce45b73d1525e52deaa83ed71629e8a47835dfe1df3911d9a60584",
        },
        {
          contractName: "ImmutableSimulator",
          bytecodeHash: "0x0100003d1f8ed700770da53630a4e91f00262d50c66ade90b3a888f292ffa420",
        },
        {
          contractName: "KnownCodesStorage",
          bytecodeHash: "0x0100007dcfde871c6aaa1c96b8a9d66c33a5bd20cdd7fd11a62c5eebc6bb3238",
        },
        {
          contractName: "L1Messenger",
          bytecodeHash: "0x010002b9341260be01cd833214e6f3d576845752dd65f40828d714a51473b0e0",
        },
        {
          contractName: "L2EthToken",
          bytecodeHash: "0x010001031bae9a1d5045c7c18b2e783b0e1948f3e6763c410d1e49dfbb472845",
        },
        {
          contractName: "MsgValueSimulator",
          bytecodeHash: "0x01000069510d6b538ef968b7a3e4a00622e55b6014fc836c8805612cfe646fee",
        },
        {
          contractName: "NonceHolder",
          bytecodeHash: "0x010000e5a5c5ea642f7f1b414f4ab9e01e22d79797316b424c80a3db417bf492",
        },
        {
          contractName: "PubdataChunkPublisher",
          bytecodeHash: "0x01000049a9d14cc0f0e701381db282516d11168e65bec83c6c3a3fa9dc1cb128",
        },
        {
          contractName: "SystemContext",
          bytecodeHash: "0x010001ab20083a6388c8c0b105359f6ee8c6eaf4598e461610427e279ede5d50",
        },
        {
          contractName: "EventWriter",
          bytecodeHash: "0x010000159a3a08da3ac57cdefec0e9e30da60456bc5643134cf16d6957bcf1ac",
        },
        {
          contractName: "CodeOracle",
          bytecodeHash: "0x01000023a41e01fe51bd507d56670250d7e1db443b04cb707d6e610508f18066",
        },
        {
          contractName: "EcAdd",
          bytecodeHash: "0x01000087290d3aab305a710f2c91fd95ba3ba174ffc9deb7b6bac2eb32e29af6",
        },
        {
          contractName: "EcMul",
          bytecodeHash: "0x010000bdca40cc75328f2fd7b8f460ac66db2011f34fd6a42363625e9c4293e0",
        },
        {
          contractName: "Ecrecover",
          bytecodeHash: "0x0100001112e34172b2bc31574d155893a087a1cf4b608cf9895a2201ea7bd6ee",
        },
        {
          contractName: "Keccak256",
          bytecodeHash: "0x0100000f248e111a1b587fef850dc4585c39af2dd505bc8a0d5cc6d3fcc7ed3c",
        },
        {
          contractName: "P256Verify",
          bytecodeHash: "0x010000114427f5e04adb275ebc6fd3b224cf020422527fc6610c2dbc98a2f8d7",
        },
        {
          contractName: "SHA256",
          bytecodeHash: "0x010000177072046ab4402036ace5c7a747d341b58e246be147b3fb7f4e5b3439",
        },
        {
          contractName: "bootloader_test",
          bytecodeHash: "0x010003a96080f61197d8e05ed160afe42e7fe9d2a509247623fc3933504a1db1",
        },
        {
          contractName: "fee_estimate",
          bytecodeHash: "0x01000905d7d0a85d94c059ea25fdf63cf6d3c616db8c0c052d9a85a7b0b2768b",
        },
        {
          contractName: "gas_test",
          bytecodeHash: "0x0100088d5f20c3f97e92737590792bce36ce326ebbb05c9948c84fd2894f266c",
        },
        {
          contractName: "playground_batch",
          bytecodeHash: "0x0100090b30022da73c3bfbd373dd9ea4eca6b68f17cae8c329f5b0b79ca11c07",
        },
        {
          contractName: "proved_batch",
          bytecodeHash: "0x0100089d6cf001d52b9e64572fa9b3555211f56a2ad66784f495c4192a88b477",
        },
      ];

      for (const { contractName, bytecodeHash } of contracts) {
        const received = await contractsRepo.byteCodeHashFor(contractName);
        expect(`${contractName} ${received}`).to.eql(`${contractName} ${bytecodeHash}`);
      }
    });

    describe("#readFile", () => {
      it("can get a top level file", async () => {
        const file = await contractsRepo.readFile("LICENSE-MIT");
        expect(file).to.eql(MIT_CONTENT);
      });

      it("can download a nested file", async () => {
        const content = await contractsRepo.readFile("l1-contracts/package.json", "f3630fc");
        const pkgJson = JSON.parse(content);
        expect(pkgJson.version).to.eql("0.1.0");
        expect(pkgJson.name).to.eql("l1-contracts");
      });

      it("errors when file does not exists", async () => {
        await expect(contractsRepo.readFile("this/file/does/not/exists.xyz")).rejects.toThrow();
      });
    });

    it("can download entire contracts", async () => {
      const content = await contractsRepo.downloadSystemContract("NonceHolder");
      const data = new ContractData("NonceHolder", content, "some address");
      data.remapKeys("system-contracts/contracts-preprocessed/", "");
      const expected = [
        "interfaces/IAccountCodeStorage.sol",
        "interfaces/IBootloaderUtilities.sol",
        "interfaces/IComplexUpgrader.sol",
        "interfaces/ICompressor.sol",
        "interfaces/IContractDeployer.sol",
        "interfaces/IEthToken.sol",
        "interfaces/IImmutableSimulator.sol",
        "interfaces/IKnownCodesStorage.sol",
        "interfaces/IL1Messenger.sol",
        "interfaces/INonceHolder.sol",
        "interfaces/IPaymasterFlow.sol",
        "interfaces/IPubdataChunkPublisher.sol",
        "interfaces/ISystemContext.sol",
        "interfaces/ISystemContract.sol",
        "libraries/EfficientCall.sol",
        "libraries/RLPEncoder.sol",
        "libraries/SystemContractHelper.sol",
        "libraries/SystemContractsCaller.sol",
        "libraries/TransactionHelper.sol",
        "libraries/Utils.sol",
        "openzeppelin/token/ERC20/extensions/IERC20Permit.sol",
        "openzeppelin/token/ERC20/IERC20.sol",
        "openzeppelin/token/ERC20/utils/SafeERC20.sol",
        "openzeppelin/utils/Address.sol",
        "Constants.sol",
        "NonceHolder.sol",
      ];
      expected.sort();
      const actual = Object.keys(data.sources);
      actual.sort();
      expect(actual).toEqual(expected);
    });
  });
});
