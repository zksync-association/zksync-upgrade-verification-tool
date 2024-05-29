import {describe, expect, it} from "vitest";
import type {Abi} from "viem";
import {ContractAbi} from "../src/lib/contract-abi";

describe('ContractAbi', () => {
  const rawAbi: Abi = [
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          internalType: "address",
          name: "to",
          type: "address"
        },
        {
          indexed: false,
          internalType: "uint256",
          name: "amount",
          type: "uint256"
        }
      ],
      name: "EthWithdrawalFinalized",
      type: "event"
    },
    {
      inputs: [
        {
          internalType: "uint256",
          name: "_l2BatchNumber",
          type: "uint256"
        },
        {
          internalType: "uint256",
          name: "_l2MessageIndex",
          type: "uint256"
        },
        {
          internalType: "uint16",
          name: "_l2TxNumberInBatch",
          type: "uint16"
        },
        {
          internalType: "bytes",
          name: "_message",
          type: "bytes"
        },
        {
          internalType: "bytes32[]",
          name: "_merkleProof",
          type: "bytes32[]"
        }
      ],
      name: "finalizeEthWithdrawal",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function"
    }
  ]

  it('can get formated for selector', () => {
    const abi = new ContractAbi(rawAbi)
    const signature = abi.signatureForSelector("0x6c0960f9")
    expect(signature).to.eql("finalizeEthWithdrawal(uint256 _l2BatchNumber, uint256 _l2MessageIndex, uint16 _l2TxNumberInBatch, bytes _message, bytes32[] _merkleProof)")
  })
})