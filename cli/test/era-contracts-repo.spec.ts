import { describe, it, expect } from "vitest";
import { EraContractsRepo } from "../src/lib/era-contracts-repo";
import { utils } from "zksync-ethers";

describe('EraContractsRepo', () => {
  describe('compile', () => {
    it('can compile and get the bytecode hash for a contract (f3630fcb01ad8b6e2e423a6f313abefe8502c3a2)', async () => {
      const repo = await EraContractsRepo.default()
      await repo.init()
      await repo.setRevision('f3630fcb01ad8b6e2e423a6f313abefe8502c3a2')
      // await repo.compile()

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

      const bytecodeHash = await repo.byteCodeHashFor('AccountCodeStorage')
      expect(bytecodeHash).to.eql("0x0100009bc0511159b5ec703d0c56f87615964017739def4ab1ee606b8ec6458c")
    })
  })
})