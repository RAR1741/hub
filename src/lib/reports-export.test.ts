import { describe, expect, test } from "vitest";
import { attendanceSummaryCsv, hoursReportCsv, toCsv } from "./reports-export";

describe("toCsv", () => {
  test("header row first, then data rows, CRLF-terminated", () => {
    const csv = toCsv(["Name", "Hours"], [["Ada", 5], ["Bo", 2]]);
    expect(csv).toBe("Name,Hours\r\nAda,5\r\nBo,2\r\n");
  });

  test("quotes fields containing a comma", () => {
    const csv = toCsv(["Name"], [["Lovelace, Ada"]]);
    expect(csv).toBe('Name\r\n"Lovelace, Ada"\r\n');
  });

  test("quotes fields containing a double quote and escapes it by doubling", () => {
    const csv = toCsv(["Note"], [['She said "hi"']]);
    expect(csv).toBe('Note\r\n"She said ""hi"""\r\n');
  });

  test("quotes fields containing an embedded newline", () => {
    const csv = toCsv(["Note"], [["line1\nline2"]]);
    expect(csv).toBe('Note\r\n"line1\nline2"\r\n');
  });

  test("null becomes an empty field", () => {
    const csv = toCsv(["A", "B"], [[null, 1]]);
    expect(csv).toBe("A,B\r\n,1\r\n");
  });

  test("no data rows still emits the header row", () => {
    expect(toCsv(["A", "B"], [])).toBe("A,B\r\n");
  });

  test("a plain numeric or unquoted-safe field is left bare", () => {
    const csv = toCsv(["A"], [[42], ["plain"]]);
    expect(csv).toBe("A\r\n42\r\nplain\r\n");
  });
});

describe("hoursReportCsv", () => {
  test("builds a Name/Student ID/Hours CSV", () => {
    const csv = hoursReportCsv([
      { name: "Ada Lovelace", studentId: "1001", hours: 12.5 },
      { name: "Bo Jones", studentId: null, hours: 0 },
    ]);
    expect(csv).toBe(
      "Name,Student ID,Hours\r\nAda Lovelace,1001,12.5\r\nBo Jones,,0\r\n",
    );
  });
});

describe("attendanceSummaryCsv", () => {
  test("builds a Name/Present/Excused/Absent/Required Days/Percent CSV", () => {
    const csv = attendanceSummaryCsv([
      { name: "Ada Lovelace", present: 8, excused: 1, absent: 1, requiredDays: 10, pct: 88.89 },
      { name: "Bo Jones", present: 0, excused: 0, absent: 0, requiredDays: 0, pct: null },
    ]);
    expect(csv).toBe(
      "Name,Present,Excused,Absent,Required Days,Percent\r\n" +
        "Ada Lovelace,8,1,1,10,88.89\r\n" +
        "Bo Jones,0,0,0,0,\r\n",
    );
  });
});
