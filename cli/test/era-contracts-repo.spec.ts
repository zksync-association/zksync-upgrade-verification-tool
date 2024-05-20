import { describe, it, expect } from "vitest";
import { EraContractsRepo } from "../src/lib/era-contracts-repo";
import { utils } from "zksync-ethers";

describe('EraContractsRepo', () => {
  describe('compile', () => {
    it('can compile and get the bytecode hash for a contract (f3630fcb01ad8b6e2e423a6f313abefe8502c3a2)', async () => {
      const repo = await EraContractsRepo.default()
      await repo.init()
      await repo.setRevision('f3630fcb01ad8b6e2e423a6f313abefe8502c3a2')
      await repo.compile()

      const bytecodeHash = await repo.byteCodeHashFor('AccountCodeStorage')
      expect(bytecodeHash).to.eql("0x0100007537b226f7de4103e8c2d1df831e990ff722dc3aca654fd45ce61bd2ec")
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