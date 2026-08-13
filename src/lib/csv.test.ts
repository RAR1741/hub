// src/lib/csv.test.ts
import { describe, expect, test } from "vitest";
import { parseCsvRecords } from "./csv";

describe("parseCsvRecords", () => {
  test("splits rows and fields, trims nothing (caller trims)", () => {
    expect(parseCsvRecords("a,b\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });
  test("honors quoted fields with embedded commas and doubled quotes", () => {
    expect(parseCsvRecords('"a,1","he said ""hi"""')).toEqual([["a,1", 'he said "hi"']]);
  });
  test("handles CRLF and a leading BOM", () => {
    expect(parseCsvRecords("﻿a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]]);
  });
});
