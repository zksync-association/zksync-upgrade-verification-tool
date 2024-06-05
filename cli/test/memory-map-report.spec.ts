import {describe, expect, it} from "vitest";
import {MemoryMap} from "../src/lib/memory-map/memory-map";
import type {MemoryDiffRaw} from "../src/schema/rpc";
import {numberToHex} from "viem";
import chalk from "chalk";
import {AddressType} from "../src/lib/memory-map/types/address-type";
import {Property} from "../src/lib/memory-map/property";
import {BigNumberType} from "../src/lib/memory-map/types/big-number-type";
import {StringMemoryReport} from "../src/lib/reports/memory-report";
import {BlobType} from "../src/lib/memory-map/types/blob-type";
import {BooleanType} from "../src/lib/memory-map/types/boolean-type";


describe("MemoryMapReport", () => {
  describe("For simple memory diff", () => {
    const boolSlot = BigInt(0xf)
    const diff: MemoryDiffRaw = {
      result: {
        pre: {
          addr: {
            storage: {
              "0x000000000000000000000000000000000000000000000000000000000000000a": numberToHex(10, { size: 32 }),
              [numberToHex(boolSlot, { size: 32 })]: numberToHex(1, { size: 32 })
            }
          }
        },
        post: {
          addr: {
            storage: {
              "0x000000000000000000000000000000000000000000000000000000000000000a": numberToHex(20, { size: 32 }),
              [numberToHex(boolSlot, { size: 32 })]: numberToHex(0, { size: 32 })
            }
          }
        }
      }
    }

    function expectedReport (name: string, description: string, before: string, after: string): string {
      return "--------------------------\n" +
        `name: ${chalk.bold(name)}\n` +
        `description: ${description}\n\n` +
        `before:\n` +
        `  ${before}\n\n` +
        `after:\n` +
        `  ${after}\n` +
        "--------------------------"
    }

    it("can display address elements", () => {
      const memoryMap = new MemoryMap(diff, "addr", [], [], [
        new Property("someProp", BigInt(0xa), "some description", new AddressType())
      ])

      const change = memoryMap.changeFor("someProp").unwrap()
      const report = new StringMemoryReport()
      report.add(change)

      expect(report.format()).toEqual(expectedReport(
        "someProp", "some description",
        numberToHex(10, {size: 20}),
        numberToHex(20, {size: 20})
      ))
    })

    it("can display types elements", () => {
      const memoryMap = new MemoryMap(diff, "addr", [], [], [
        new Property("numberProp", BigInt(0xa), "it is a number", new BigNumberType())
      ])

      const change = memoryMap.changeFor("numberProp").unwrap()
      const report = new StringMemoryReport()
      report.add(change)

      expect(report.format()).toEqual(expectedReport(
        "numberProp", "it is a number",
        "10",
        "20"
      ))
    })

    it("can display blob elements", () => {
      const memoryMap = new MemoryMap(diff, "addr", [], [], [
        new Property("blobProp", BigInt(0xa), "it is a blob", new BlobType())
      ])

      const change = memoryMap.changeFor("blobProp").unwrap()
      const report = new StringMemoryReport()
      report.add(change)

      expect(report.format()).toEqual(expectedReport(
        "blobProp", "it is a blob",
        numberToHex(10, {size: 32}),
        numberToHex(20, {size: 32})
      ))
    })

    it("can display boolean elements", () => {
      const memoryMap = new MemoryMap(diff, "addr", [], [], [
        new Property("blobProp", boolSlot, "it is a blob", new BooleanType())
      ])

      const change = memoryMap.changeFor("blobProp").unwrap()
      const report = new StringMemoryReport()
      report.add(change)

      expect(report.format()).toEqual(expectedReport(
        "blobProp", "it is a blob",
        "true",
        "false"
      ))
    })
  })
})