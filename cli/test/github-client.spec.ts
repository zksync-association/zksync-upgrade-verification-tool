  import { describe, it, expect } from "vitest";
  import { GithubClient } from '../src/lib/github-client'

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
  `

  describe('Github client', () => {
    it('can get a top level file', async () => {
      const client = new GithubClient('f3630fc')
      const file = await client.downloadFile('LICENSE-MIT')
      expect(file).to.eql(MIT_CONTENT)
    })

    it('can download a nested file', async () => {
      const client = new GithubClient('f3630fc')
      const content = await client.downloadFile('l1-contracts/package.json')
      const pkgJson = JSON.parse(content)
      expect(pkgJson.version).to.eql('0.1.0')
      expect(pkgJson.name).to.eql('l1-contracts')
    })

    it('can download entire contracts', async (t) => {
      const client = new GithubClient('f3630fc')
      const content = await client.downloadSystemContract('EcAdd')
      expect(Object.keys(content)).to.have.length(11)
    })
  })