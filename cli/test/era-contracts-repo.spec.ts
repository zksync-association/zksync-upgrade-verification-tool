import { describe, it, expect } from "vitest";
import { EraContractsRepo } from "../src/lib/era-contracts-repo";
import { ContractData } from "../src/lib";

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

describe.sequential('EraContractsRepo', () => {
  describe.sequential('compile', () => {
    it('can compile and get the bytecode hash for a contract (f3630fcb01ad8b6e2e423a6f313abefe8502c3a2)', async () => {
      const repo = await EraContractsRepo.default()
      await repo.init()
      await repo.setRevision('f3630fcb01ad8b6e2e423a6f313abefe8502c3a2')
      await repo.compile()

      const contracts = [
        {
          contractName: "AccountCodeStorage",
          bytecodeHash: "0x0100007537b226f7de4103e8c2d1df831e990ff722dc3aca654fd45ce61bd2ec",
        },
        {
          contractName: "BootloaderUtilities",
          bytecodeHash: "0x010007c975f78e50264c2d3b4deb89cbbb04a04a105dd3524848bad5329948f2",
        },
        {
          contractName: "ComplexUpgrader",
          bytecodeHash: "0x0100005589186a7446ebd5e1d568dada8f903693ea9daa75b010981f3e9e2585",
        },
        {
          contractName: "Compressor",
          bytecodeHash: "0x01000167fb76a165404d403ea1d5853cdefe4e71b93d595125f7576981381919",
        },
        {
          contractName: "ContractDeployer",
          bytecodeHash: "0x010005559dd27f9279b39dce0350dbef9636e743b7f00edf49b40f23b90e523b",
        },
        {
          contractName: "DefaultAccount",
          bytecodeHash: "0x0100055b041eb28aff6e3a6e0f37c31fd053fc9ef142683b05e5f0aee6934066",
        },
        {
          contractName: "EmptyContract",
          bytecodeHash: "0x01000007f845e3f2ab16646632231e4fee11627449b45067fa0e7c76ba114d06",
        },
        {
          contractName: "ImmutableSimulator",
          bytecodeHash: "0x0100003d5fe89ded57edee93a69c969ad6f43a4fcf22dc24f0b8742f27e0410f",
        },
        {
          contractName: "KnownCodesStorage",
          bytecodeHash: "0x0100007d0340c8a63df15d428ff5ab8acc61c74e67874c5252656ff9a694aacf",
        },
        {
          contractName: "L1Messenger",
          bytecodeHash: "0x010002af715306a32366b81dee75e9f888355e430bfe591228314b08ce2d77d9",
        },
        {
          contractName: "L2EthToken",
          bytecodeHash: "0x01000101390b0b7b816627d366d34fe732328fafc6ba339be74376c6219d3a3f",
        },
        {
          contractName: "MsgValueSimulator",
          bytecodeHash: "0x010000632c2595abece956e70cf98f7f95672588c636500ebfee820547ff723d",
        },
        {
          contractName: "NonceHolder",
          bytecodeHash: "0x010000e53b54bc7d1e273de73918fe1b12123c61e0fb0c1ab2ac94839d311029",
        },
        {
          contractName: "PubdataChunkPublisher",
          bytecodeHash: "0x010000472947f34d576bdcf99b520fa40c159e32ddce9fc600d65e2469f6a267",
        },
        {
          contractName: "SystemContext",
          bytecodeHash: "0x01000181520b3a64b82e423d221b35739c35c0021e586e911531b6987c33562d",
        },
        {
          contractName: "EventWriter",
          bytecodeHash: "0x0100001752ddb6f7d76adaf32594816c0bda5b9c17d6fd86e90a06acba2e4cb6",
        },
        {
          contractName: "EcAdd",
          bytecodeHash: "0x0100008f337dc5cc92411071569be5cd4bfd755adf20021c8a0e316c4834c4ef",
        },
        {
          contractName: "EcMul",
          bytecodeHash: "0x010000d941fe2d54aa725915db7d63795e02ced38fa2709d736631e30792ccb2",
        },
        {
          contractName: "Ecrecover",
          bytecodeHash: "0x0100001147fcb33fbc266df8067be8b51d68ad9362a6204de5a6b2279c613d12",
        },
        {
          contractName: "Keccak256",
          bytecodeHash: "0x0100000fb004b644efe76e9ef3ba89dfa3eaac946e3fa19f8a046ed27465eeef",
        },
        {
          contractName: "SHA256",
          bytecodeHash: "0x010000179d3c90b59acbc8fbda5ba2389cc80dfa840840e5183d44ea3c9b0131",
        },
        {
          contractName: "bootloader_test",
          bytecodeHash: "0x01000347e73f7fd172cf7ac124a8d709281635681f3091f977ac3c966b52777a",
        },
        {
          contractName: "fee_estimate",
          bytecodeHash: "0x0100080b27dab34e52063ba3f1c56d545ba01cfb9ddfdc862d3495df2a7c97b9",
        },
        {
          contractName: "gas_test",
          bytecodeHash: "0x010007db160db5b3f3065cc117f64e297a4c274185d7d565f6887d4e724468c2",
        },
        {
          contractName: "playground_batch",
          bytecodeHash: "0x01000813831e3f41ff63cdf3259a9352d22ecb8c53bfd3d4ecc39856b8670933",
        },
        {
          contractName: "proved_batch",
          bytecodeHash: "0x010007ede999d096c84553fb514d3d6ca76fbf39789dda76bfeda9f3ae06236e",
        }
      ];


      for (const { contractName, bytecodeHash } of contracts) {
        const received = await repo.byteCodeHashFor(contractName)
        expect(`${contractName} ${received}`).to.eql(`${contractName} ${bytecodeHash}`)
      }
    })

    it('can compile and get the bytecode hash for a contract (e77971dba8f589b625e72e69dd7e33ccbe697cc0)', async () => {
      const repo = await EraContractsRepo.default()
      await repo.init()
      await repo.setRevision('e77971dba8f589b625e72e69dd7e33ccbe697cc0')
      await repo.compile()

      const contracts = [
        {
          contractName: "AccountCodeStorage",
          bytecodeHash: "0x0100009bc0511159b5ec703d0c56f87615964017739def4ab1ee606b8ec6458c"
        },
        {
          contractName: "BootloaderUtilities",
          bytecodeHash: "0x010009759cab4fa9e6ca0784746e1df600ff523f0f90c1e94191755cab4b2ed0"
        },
        {
          contractName: "ComplexUpgrader",
          bytecodeHash: "0x0100005bfc0443349233459892b51e9f67e27ac828d44d9c7cba8c8285fd66bc"
        },
        {
          contractName: "Compressor",
          bytecodeHash: "0x010001b72874590239af612f65d50a35975299f88de022493fe7f0a190e79496"
        },
        {
          contractName: "ContractDeployer",
          bytecodeHash: "0x010006091341955c8f76409de00549fb00b275166b5a0d0d7b82cbd629bb4212"
        },
        {
          contractName: "DefaultAccount",
          bytecodeHash: "0x01000651c5ae96f2aab07d720439e42491bb44c6384015e3a08e32620a4d582d"
        },
        {
          contractName: "EmptyContract",
          bytecodeHash: "0x01000007271e9710c356751295d83a25ffec94be2b4ada01ec1fa04c7cd6f2c7"
        },
        {
          contractName: "ImmutableSimulator",
          bytecodeHash: "0x01000047a3c40e3f4eb98f14967f141452ae602d8723a10975dc33960911d8c5"
        },
        {
          contractName: "KnownCodesStorage",
          bytecodeHash: "0x0100008b0ca6c6f277035366e99407fbb4b01e743e80b7d24dea5a3d647b423e"
        },
        {
          contractName: "L1Messenger",
          bytecodeHash: "0x01000301c943edb65f5a0b8cdd806218b8ecf25c022720fe3afe6951f202f3fa"
        },
        {
          contractName: "L2EthToken",
          bytecodeHash: "0x01000139b506af2b02225838c5a33e30ace701b44b210a422eedab7dd31c28a3"
        },
        {
          contractName: "MsgValueSimulator",
          bytecodeHash: "0x0100006fa1591d93fcc4a25e9340ad11d0e825904cd1842b8f7255701e1aacbb"
        },
        {
          contractName: "NonceHolder",
          bytecodeHash: "0x0100012fa73fa922dd9fabb40d3275ce80396eff6ccf1b452c928c17d98bd470"
        },
        {
          contractName: "SystemContext",
          bytecodeHash: "0x0100023ba65021e4689dd1755f82108214a1f25150d439fe58c55cdb1f376436"
        },
        {
          contractName: "EventWriter",
          bytecodeHash: "0x01000019642d87621fdd82cf65aa9146486c9256d5f8849af9a37c78ef519339"
        },
        {
          contractName: "EcAdd",
          bytecodeHash: "0x010000c5a85a372f441ac693210a18e683b530bed875fdcab2f7e101b057d433"
        },
        {
          contractName: "EcMul",
          bytecodeHash: "0x0100013759b40792c2c3d033990e992e5508263c15252eb2d9bfbba571350675"
        },
        {
          contractName: "Ecrecover",
          bytecodeHash: "0x010000114daca2ff44f27d543b8ef67d885bfed09a74ba9cb25f5912dd3d739c"
        },
        {
          contractName: "Keccak256",
          bytecodeHash: "0x0100001fb52ca33668d01c230a1c3b13ede90fe2e37d77222410e9f183cb7a89"
        },
        {
          contractName: "SHA256",
          bytecodeHash: "0x010000178d93b2d7d6448866009892223caf018a8e8dbcf090c2b9053a285f8d"
        },
        {
          contractName: "bootloader_test",
          bytecodeHash: "0x0100038548508a2a29b0c6e8a86fc0ec5c512baf563155e8171afd1a060c81fa"
        },
        {
          contractName: "fee_estimate",
          bytecodeHash: "0x01000989a967ab5b446c084adf05e13399a24e5cf37e9cf7db05a5dd6d7c5e0b"
        },
        {
          contractName: "gas_test",
          bytecodeHash: "0x0100096912f983649836f812c6db81c814cc0a5ff24b80ecffbf79ca01e7946c"
        },
        {
          contractName: "playground_batch",
          bytecodeHash: "0x0100099308cc5367de190e240aa355df7d0cfacb6a752726bad8f3100044629f"
        },
        {
          contractName: "proved_batch",
          bytecodeHash: "0x01000983d4ac4f797cf5c077e022f72284969b13248c2a8e9846f574bdeb5b88"
        }
      ]

      for (const { contractName, bytecodeHash } of contracts) {
        const received = await repo.byteCodeHashFor(contractName)
        expect(`${contractName} ${received}`).to.eql(`${contractName} ${bytecodeHash}`)
      }
    })
  })

  describe('#readFile', () => {
    it("can get a top level file", async () => {
      const repo = await EraContractsRepo.default()
      await repo.init()

      const file = await repo.readFile("LICENSE-MIT");
      expect(file).to.eql(MIT_CONTENT);
    });

    it("can download a nested file", async () => {
      const repo = await EraContractsRepo.default()
      await repo.init()
      const content = await repo.readFile("l1-contracts/package.json", "f3630fc");
      const pkgJson = JSON.parse(content);
      expect(pkgJson.version).to.eql("0.1.0");
      expect(pkgJson.name).to.eql("l1-contracts");
    });

    it("errors when file does not exists", async () => {
      const repo = await EraContractsRepo.default()
      await repo.init()
      await expect(repo.readFile("this/file/does/not/exists.xyz")).rejects.toThrow()
    });
  });

  describe('#downloadContract', () => {
    it("can download entire contracts", async () => {
      // a8f589b625e72e69dd7e33ccbe697cc0
      const repo = await EraContractsRepo.default()
      await repo.init();
      await repo.setRevision("e77971db")

      const content = await repo.downloadSystemContract("NonceHolder");
      const data = new ContractData("NonceHolder", content, "some address");
      data.remapKeys("system-contracts/contracts/", "");
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
})