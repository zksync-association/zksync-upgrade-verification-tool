import { Octokit } from '@octokit/core'
import * as console from "node:console";

const octo = new Octokit()

const response1 = await octo.request('GET /repos/{owner}/{repo}/contents/{path}{?ref}', {
  owner: "matter-labs",
  repo: "era-contracts",
  path: "system-contracts/contracts",
  ref: "e77971dba8f589b625e72e69dd7e33ccbe697cc0",
  headers: {
    'X-GitHub-Api-Version': '2022-11-28'
  }
})

// const response2 = await octo.request('GET /repos/{owner}/{repo}/contents/{path}{?ref}', {
//   owner: "matter-labs",
//   repo: "era-contracts",
//   path: "system-contracts/SystemContractsHashes.json",
//   ref: "abfad6f1b75348052d38a7bf5ca596e6993d8d96",
//   headers: {
//     'X-GitHub-Api-Version': '2022-11-28'
//   }
// })

console.log(response1)
// console.log(Buffer.from(response1.data.content, 'base64').toString())

// console.log(Buffer.from(response2.data.content, 'base64').toString())