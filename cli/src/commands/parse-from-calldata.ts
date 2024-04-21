import {lookupAndParse, type Network} from "../lib";
import {AbiSet} from "../lib/abi-set";
import path from "node:path";
import {decodeFunctionData, decodeFunctionResult, encodeFunctionData} from "viem";
import {facetsResponseSchema} from "../schema/new-facets";
import {executeUpgradeSchema} from "../schema/execute-upgrade-schema";
import {initCallDataSchema} from "../schema/init-call-data";

async function simpleRead(target: string, callData: string): Promise<string> {
  const response = await fetch(
    'https://eth-mainnet.g.alchemy.com/v2/f-Lt_8EsHek4y9P-VwIFD_ACa0ihw1Lm',
    {
      method: 'POST',
      body: JSON.stringify(
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [{
            to: target,
            gas: "0xfffffff",
            gasPrice: "0x9184e72a000",
            value: "0x0",
            data: callData
          }]
        }
      )
    }
  )

  const json = await response.json() as { result: string }
  return json.result
}

export class Diamond {
  private addr: string;
  private abis: AbiSet

  selectorToFacet: Map<string, string>
  facetToSelectors: Map<string, string[]>


  constructor(addr: string, abis: AbiSet) {
    this.addr = addr
    this.abis = abis
    this.selectorToFacet = new Map()
    this.facetToSelectors = new Map()
  }


  async init() {
    const data = await simpleRead(this.addr, '0xcdffacc67a0ed62700000000000000000000000000000000000000000000000000000000')
    const facetsAddr = `0x${data.substring(26)}`

    const abi = await this.abis.fetch(facetsAddr)

    const facetsData = await simpleRead(this.addr, '0x7a0ed627')
    const rawFacets = decodeFunctionResult({
      abi,
      functionName: 'facets',
      data: facetsData as `0x${string}`
    })


    const facets = facetsResponseSchema.parse(rawFacets)

    facets.forEach(facet => {
      this.facetToSelectors.set(facet.addr, facet.selectors)
      facet.selectors.forEach(selector => {
        this.selectorToFacet.set(selector, facet.addr)
      })
    })
  }
}


export async function parseFromCalldata(ethscanKey: string, upgradeDirectory: string, parentDirectory: string, network: Network): Promise<void> {
  const abis = new AbiSet(network, ethscanKey)
  const basePath = path.resolve(process.cwd(), parentDirectory || "", upgradeDirectory);
  const upgrade = await lookupAndParse(basePath, network);

  const {
    data,
    target
  } = upgrade.transactions.governanceOperation.calls[0]

  const diamond = new Diamond(target, abis)
  await diamond.init()

  const facetAddr = diamond.selectorToFacet.get(data.substring(0, 10))!
  const abi = await abis.fetch(facetAddr)
  const decoded = decodeFunctionData({
    abi,
    data: data as `0x{string}`
  })

  const execUpgrade = executeUpgradeSchema.parse(decoded)
  // console.log(execUpgrade.args[0].facetCuts)

  const abi2 = await abis.fetch(execUpgrade.args[0].initAddress)

  const {args: decoded2} = decodeFunctionData({
    abi: abi2,
    data: execUpgrade.args[0].initCalldata as `0x{string}`
  })

  if (!decoded2) {
    throw new Error('no decode 2')
  }

  const parsed2 = initCallDataSchema.parse(decoded2[0])
  // console.log(parsed2)

  const _abi = [
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          internalType: "address",
          name: "accountAddress",
          type: "address",
        },
        {
          indexed: false,
          internalType: "enum IContractDeployer.AccountNonceOrdering",
          name: "nonceOrdering",
          type: "uint8",
        },
      ],
      name: "AccountNonceOrderingUpdated",
      type: "event",
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          internalType: "address",
          name: "accountAddress",
          type: "address",
        },
        {
          indexed: false,
          internalType: "enum IContractDeployer.AccountAbstractionVersion",
          name: "aaVersion",
          type: "uint8",
        },
      ],
      name: "AccountVersionUpdated",
      type: "event",
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          internalType: "address",
          name: "deployerAddress",
          type: "address",
        },
        {
          indexed: true,
          internalType: "bytes32",
          name: "bytecodeHash",
          type: "bytes32",
        },
        {
          indexed: true,
          internalType: "address",
          name: "contractAddress",
          type: "address",
        },
      ],
      name: "ContractDeployed",
      type: "event",
    },
    {
      inputs: [
        {
          internalType: "bytes32",
          name: "_salt",
          type: "bytes32",
        },
        {
          internalType: "bytes32",
          name: "_bytecodeHash",
          type: "bytes32",
        },
        {
          internalType: "bytes",
          name: "_input",
          type: "bytes",
        },
      ],
      name: "create",
      outputs: [
        {
          internalType: "address",
          name: "",
          type: "address",
        },
      ],
      stateMutability: "payable",
      type: "function",
    },
    {
      inputs: [
        {
          internalType: "bytes32",
          name: "_salt",
          type: "bytes32",
        },
        {
          internalType: "bytes32",
          name: "_bytecodeHash",
          type: "bytes32",
        },
        {
          internalType: "bytes",
          name: "_input",
          type: "bytes",
        },
      ],
      name: "create2",
      outputs: [
        {
          internalType: "address",
          name: "",
          type: "address",
        },
      ],
      stateMutability: "payable",
      type: "function",
    },
    {
      inputs: [
        {
          internalType: "bytes32",
          name: "_salt",
          type: "bytes32",
        },
        {
          internalType: "bytes32",
          name: "_bytecodeHash",
          type: "bytes32",
        },
        {
          internalType: "bytes",
          name: "_input",
          type: "bytes",
        },
        {
          internalType: "enum IContractDeployer.AccountAbstractionVersion",
          name: "_aaVersion",
          type: "uint8",
        },
      ],
      name: "create2Account",
      outputs: [
        {
          internalType: "address",
          name: "",
          type: "address",
        },
      ],
      stateMutability: "payable",
      type: "function",
    },
    {
      inputs: [
        {
          internalType: "bytes32",
          name: "",
          type: "bytes32",
        },
        {
          internalType: "bytes32",
          name: "_bytecodeHash",
          type: "bytes32",
        },
        {
          internalType: "bytes",
          name: "_input",
          type: "bytes",
        },
        {
          internalType: "enum IContractDeployer.AccountAbstractionVersion",
          name: "_aaVersion",
          type: "uint8",
        },
      ],
      name: "createAccount",
      outputs: [
        {
          internalType: "address",
          name: "",
          type: "address",
        },
      ],
      stateMutability: "payable",
      type: "function",
    },
    {
      inputs: [
        {
          internalType: "address",
          name: "_address",
          type: "address",
        },
      ],
      name: "extendedAccountVersion",
      outputs: [
        {
          internalType: "enum IContractDeployer.AccountAbstractionVersion",
          name: "",
          type: "uint8",
        },
      ],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [
        {
          components: [
            {
              internalType: "bytes32",
              name: "bytecodeHash",
              type: "bytes32",
            },
            {
              internalType: "address",
              name: "newAddress",
              type: "address",
            },
            {
              internalType: "bool",
              name: "callConstructor",
              type: "bool",
            },
            {
              internalType: "uint256",
              name: "value",
              type: "uint256",
            },
            {
              internalType: "bytes",
              name: "input",
              type: "bytes",
            },
          ],
          internalType: "struct ContractDeployer.ForceDeployment",
          name: "_deployment",
          type: "tuple",
        },
        {
          internalType: "address",
          name: "_sender",
          type: "address",
        },
      ],
      name: "forceDeployOnAddress",
      outputs: [],
      stateMutability: "payable",
      type: "function",
    },
    {
      inputs: [
        {
          components: [
            {
              internalType: "bytes32",
              name: "bytecodeHash",
              type: "bytes32",
            },
            {
              internalType: "address",
              name: "newAddress",
              type: "address",
            },
            {
              internalType: "bool",
              name: "callConstructor",
              type: "bool",
            },
            {
              internalType: "uint256",
              name: "value",
              type: "uint256",
            },
            {
              internalType: "bytes",
              name: "input",
              type: "bytes",
            },
          ],
          internalType: "struct ContractDeployer.ForceDeployment[]",
          name: "_deployments",
          type: "tuple[]",
        },
      ],
      name: "forceDeployOnAddresses",
      outputs: [],
      stateMutability: "payable",
      type: "function",
    },
    {
      inputs: [
        {
          internalType: "address",
          name: "_address",
          type: "address",
        },
      ],
      name: "getAccountInfo",
      outputs: [
        {
          components: [
            {
              internalType: "enum IContractDeployer.AccountAbstractionVersion",
              name: "supportedAAVersion",
              type: "uint8",
            },
            {
              internalType: "enum IContractDeployer.AccountNonceOrdering",
              name: "nonceOrdering",
              type: "uint8",
            },
          ],
          internalType: "struct IContractDeployer.AccountInfo",
          name: "info",
          type: "tuple",
        },
      ],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [
        {
          internalType: "address",
          name: "_sender",
          type: "address",
        },
        {
          internalType: "uint256",
          name: "_senderNonce",
          type: "uint256",
        },
      ],
      name: "getNewAddressCreate",
      outputs: [
        {
          internalType: "address",
          name: "newAddress",
          type: "address",
        },
      ],
      stateMutability: "pure",
      type: "function",
    },
    {
      inputs: [
        {
          internalType: "address",
          name: "_sender",
          type: "address",
        },
        {
          internalType: "bytes32",
          name: "_bytecodeHash",
          type: "bytes32",
        },
        {
          internalType: "bytes32",
          name: "_salt",
          type: "bytes32",
        },
        {
          internalType: "bytes",
          name: "_input",
          type: "bytes",
        },
      ],
      name: "getNewAddressCreate2",
      outputs: [
        {
          internalType: "address",
          name: "newAddress",
          type: "address",
        },
      ],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [
        {
          internalType: "enum IContractDeployer.AccountAbstractionVersion",
          name: "_version",
          type: "uint8",
        },
      ],
      name: "updateAccountVersion",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
    {
      inputs: [
        {
          internalType: "enum IContractDeployer.AccountNonceOrdering",
          name: "_nonceOrdering",
          type: "uint8",
        },
      ],
      name: "updateNonceOrdering",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
  ];
  // console.log(encodeFunctionData({ abi: _abi, functionName: 'upgrade' }))

  const lala = decodeFunctionData({
    abi: _abi,
    data: parsed2.l2ProtocolUpgradeTx.data as `0x{string}`
  })

  console.log(parsed2.l2ProtocolUpgradeTx.to)

  // console.log(lala.args)

  // console.log(JSON.stringify(decoded, null, 2))
  //
  // const abi = await abis.fetch(facetAddr)
  //
  // console.log(abi)
}