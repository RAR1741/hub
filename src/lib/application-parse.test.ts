// src/lib/application-parse.test.ts
import { describe, expect, test } from "vitest";
import { nameKey, parseApplications } from "./application-parse";

// Header rows lifted verbatim from the real source CSVs (columns as originally
// exported by Google Forms) to exercise the year-to-year drift matrix. Data
// values below are entirely synthetic — no real applicant PII. Kept as
// arrays (not raw strings) so data rows can be built by column name instead of
// hand-counted commas.

function csvField(v: string): string {
  return v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v;
}
function csvRow(fields: string[]): string {
  return fields.map(csvField).join(",");
}
/** Build a data row aligned to `header` by column name; unspecified columns are "". */
function rowFor(header: string[], values: Record<string, string>): string {
  return csvRow(header.map((h) => values[h] ?? ""));
}

const HEADER_2022 = [
  "Timestamp",
  "First Name",
  "Preferred Name",
  "Last Name",
  "Date of Birth",
  "What is your high school graduation year?",
  "What school are you attending for the 2021-2022 School Year?",
  "Street Address",
  "City",
  "Zip Code",
  "Home Phone Number",
  "Cell Phone Number",
  "Email Address",
  "T-shirt Size?",
  "Parent/Guardian First Name",
  "Parent/Guardian Last Name",
  "Parent/Guardian Relationship to Student",
  "Parent/Guardian Cell Phone Number",
  "Parent/Guardian email address",
  "Parent/Guardian 2 (if applicable)",
  "Parent/Guardian 2",
  "Parent/Guardian 2 Relationship to Student",
  "Parent/Guardian 2 Cell Phone Number",
  "Parent/Guardian 2 Email Address",
  "Please check all items of interest",
  "Please check the boxes for any previous years you have participated as a student in FLL Jr.",
  "Please check the boxes for any previous years you have participated as a student in FLL",
  "Please check the boxes for any previous years you have participated as a student in FTC",
  "Please check the boxes for any previous years you have participated as a student in FRC",
  "Attended Call Out? ",
];

const HEADER_2023 = [
  "Timestamp",
  "First Name",
  "Preferred Name",
  "Last Name",
  "Email Address",
  "Date of Birth",
  "What is your high school graduation year?",
  "What school are you attending for the 2022-2023 School Year?",
  "Street Address",
  "City",
  "Zip Code",
  "Home Phone Number",
  "Cell Phone Number",
  "T-shirt Size?",
  "Parent/Guardian First Name",
  "Parent/Guardian Last Name",
  "Parent/Guardian Relationship to Student",
  "Parent/Guardian Cell Phone Number",
  "Parent/Guardian email address",
  "Parent/Guardian 2 (if applicable)",
  "Parent/Guardian 2",
  "Parent/Guardian 2 Relationship to Student",
  "Parent/Guardian 2 Cell Phone Number",
  "Parent/Guardian 2 Email Address",
  "Please check all items of interest",
  "Please check the boxes for any previous years you have participated as a student in FLL Jr.",
  "Please check the boxes for any previous years you have participated as a student in FLL",
  "Please check the boxes for any previous years you have participated as a student in FTC",
  "Please check the boxes for any previous years you have participated as a student in FRC",
];

const HEADER_2024 = [
  "Timestamp",
  "First Name",
  "Preferred Name",
  "Last Name",
  "Date of Birth",
  "What is your high school graduation year?",
  "What school are you attending for the 2023-2024 School Year?",
  "Street Address",
  "City",
  "Zip Code",
  "Home Phone Number",
  "Cell Phone Number",
  "Email Address",
  "T-shirt Size?",
  "What is your ethnicity?",
  "What is your race?",
  "Parent/Guardian First Name",
  "Parent/Guardian Last Name",
  "Parent/Guardian Relationship to Student",
  "Parent/Guardian Cell Phone Number",
  "Parent/Guardian email address",
  "Parent/Guardian 2 (if applicable)",
  "Parent/Guardian 2",
  "Parent/Guardian 2 Relationship to Student",
  "Parent/Guardian 2 Cell Phone Number",
  "Parent/Guardian 2 Email Address",
  "Please check all items of interest",
  "Please check the boxes for any previous years you have participated as a student in FLL Explore (Formerly FLL Jr.) (Do not check for mentoring a team)",
  "Please check the boxes for any previous years you have participated as a student in FLL",
  "Please check the boxes for any previous years you have participated as a student in FTC",
  "Did you participate as a camper in Radical Robot Camp?",
  "Please check the boxes for any previous years you have participated as a student in FRC",
];

const HEADER_2025 = [
  "Timestamp",
  "First Name",
  "Preferred Name",
  "Last Name",
  "Date of Birth",
  "What is your high school graduation year?",
  "What school are you attending for the 2024-2025 School Year?",
  "Street Address",
  "City",
  "Zip Code",
  "Home Phone Number",
  "Cell Phone Number",
  "Email Address",
  "T-shirt Size?",
  "What is your ethnicity?",
  "What is your race?",
  "Parent/Guardian First Name",
  "Parent/Guardian Last Name",
  "Parent/Guardian Relationship to Student",
  "Parent/Guardian Cell Phone Number",
  "Parent/Guardian email address",
  "Parent/Guardian 2 (if applicable)",
  "Parent/Guardian 2",
  "Parent/Guardian 2 Relationship to Student",
  "Parent/Guardian 2 Cell Phone Number",
  "Parent/Guardian 2 Email Address",
  "Please check all items of interest",
  "Please check the boxes for any previous years you have participated as a student in FLL Explore (Formerly FLL Jr.) (Do not check for mentoring a team)",
  "Please check the boxes for any previous years you have participated as a student in FLL Challenge",
  "Please check the boxes for any previous years you have participated as a student in FTC",
  "Did you participate as a camper in Radical Robot Camp?",
  "Please check the boxes for any previous years you have participated as a student in FRC",
  "", // 2025 quirk: single trailing unlabeled column holds allergy text
];

const HEADER_2027 = [
  "Timestamp",
  "First Name",
  "Preferred Name",
  "Last Name",
  "Date of Birth",
  "What is your high school graduation year?",
  "What school are you attending for the 2026-2027 School Year?",
  "Street Address",
  "City",
  "Zip Code",
  "Home Phone Number",
  "Cell Phone Number",
  "Email Address",
  "T-shirt Size?",
  "What is your ethnicity?",
  "What is your race?",
  "Parent/Guardian First Name",
  "Parent/Guardian Last Name",
  "Parent/Guardian Relationship to Student",
  "Parent/Guardian Cell Phone Number",
  "If applicable, parent/guardian's place of employment? ",
  "Parent/Guardian email address",
  "Parent/Guardian 2 (if applicable)",
  "Parent/Guardian 2",
  "Parent/Guardian 2 Relationship to Student",
  "Parent/Guardian 2 Cell Phone Number",
  "Parent/Guardian 2 Email Address",
  "Parent/guardian 2 place of employment, if applicable.",
  "Please check all items of interest",
  "Please check the boxes for any previous years you have participated as a student in FLL Explore (Formerly FLL Jr.) (Do not check for mentoring a team)",
  "Please check the boxes for any previous years you have participated as a student in FLL Challenge",
  "Please check the boxes for any previous years you have participated as a student in FTC",
  "Did you participate as a camper in Radical Robot Camp?",
  "Please check the boxes for any previous years you have participated as a student in FRC",
];

describe("parseApplications - header drift matrix", () => {
  test("2022 header: email at col 12, no race/ethnicity, FLL Jr. label", () => {
    const row = rowFor(HEADER_2022, {
      Timestamp: "5/19/2021 16:05:09",
      "First Name": "Ada",
      "Preferred Name": "Ada",
      "Last Name": "Lovelace",
      "Date of Birth": "8/7/2004",
      "What is your high school graduation year?": "2022",
      "What school are you attending for the 2021-2022 School Year?": "Test High School",
      "Street Address": "123 Test St",
      City: "Testville",
      "Zip Code": "00000",
      "Home Phone Number": "N/A",
      "Cell Phone Number": "555-0101",
      "Email Address": "ada@example.com",
      "T-shirt Size?": "M",
      "Parent/Guardian First Name": "Pat",
      "Parent/Guardian Last Name": "Lovelace",
      "Parent/Guardian Relationship to Student": "Mother",
      "Parent/Guardian Cell Phone Number": "555-0102",
      "Parent/Guardian email address": "pat@example.com",
      "Parent/Guardian 2 (if applicable)": "Sam",
      "Parent/Guardian 2": "Lovelace",
      "Parent/Guardian 2 Relationship to Student": "Father",
      "Parent/Guardian 2 Cell Phone Number": "555-0103",
      "Parent/Guardian 2 Email Address": "sam@example.com",
      "Please check all items of interest": "Electronics, Programming",
      "Please check the boxes for any previous years you have participated as a student in FLL": "2017-2018 Relic Recovery",
      "Please check the boxes for any previous years you have participated as a student in FTC": "2019 FIRST Deep Space",
      "Attended Call Out? ": "No",
    });
    const csv = `${csvRow(HEADER_2022)}\n${row}`;
    const result = parseApplications(csv);

    expect(result.seasonYear).toBe(2022);
    expect(result.applications).toHaveLength(1);
    const app = result.applications[0];
    expect(app.firstName).toBe("Ada");
    expect(app.lastName).toBe("Lovelace");
    expect(app.email).toBe("ada@example.com");
    expect(app.homePhone).toBeNull(); // N/A
    expect(app.phone).toBe("5550101");
    expect(app.ethnicity).toBeNull();
    expect(app.race).toBeNull();
    expect(app.interests).toEqual(["Electronics", "Programming"]);
    expect(app.guardians).toHaveLength(2);
    expect(app.guardians[0]).toMatchObject({ firstName: "Pat", lastName: "Lovelace", relationship: "Mother" });
    expect(app.guardians[1]).toMatchObject({ firstName: "Sam", lastName: "Lovelace", relationship: "Father" });
    expect(app.experiences).toEqual(
      expect.arrayContaining([
        { level: "fll_challenge", year: 2018, name: "Relic Recovery" },
        { level: "ftc", year: 2019, name: "FIRST Deep Space" },
      ]),
    );
  });

  test("2023 header: email moved to col 4, still parses correctly", () => {
    const row = rowFor(HEADER_2023, {
      Timestamp: "8/4/2022 19:07:31",
      "First Name": "Nora",
      "Last Name": "Fixture",
      "Email Address": "nora@example.com",
      "Date of Birth": "2/1/2005",
      "What is your high school graduation year?": "2023",
      "What school are you attending for the 2022-2023 School Year?": "Test High School",
      "Street Address": "456 Example Ave",
      City: "Testville",
      "Zip Code": "00000",
      "Home Phone Number": "555-0104",
      "Cell Phone Number": "555-0105",
      "T-shirt Size?": "M",
      "Parent/Guardian First Name": "Dana",
      "Parent/Guardian Last Name": "Fixture",
      "Parent/Guardian Relationship to Student": "Mother",
      "Parent/Guardian Cell Phone Number": "555-0104",
      "Parent/Guardian email address": "dana@example.com",
      "Parent/Guardian 2 (if applicable)": "John",
      "Parent/Guardian 2": "Fixture",
      "Parent/Guardian 2 Cell Phone Number": "555-0106",
      "Please check all items of interest": "Communication, Graphic Design",
    });
    const csv = `${csvRow(HEADER_2023)}\n${row}`;
    const result = parseApplications(csv);

    expect(result.seasonYear).toBe(2023);
    const app = result.applications[0];
    expect(app.firstName).toBe("Nora");
    expect(app.email).toBe("nora@example.com");
    expect(app.dob).toBe("2005-02-01");
    expect(app.guardians[1]).toMatchObject({ firstName: "John", lastName: "Fixture", relationship: null, email: null });
  });

  test("2024 header: adds race/ethnicity, FLL Jr renamed FLL Explore, FLL bare label", () => {
    const row = rowFor(HEADER_2024, {
      Timestamp: "8/10/2023 21:50:12",
      "First Name": "Bram",
      "Last Name": "Example",
      "Date of Birth": "3/2/2006",
      "What is your high school graduation year?": "2024",
      "What school are you attending for the 2023-2024 School Year?": "Test High School",
      "Street Address": "789 Example Ave",
      City: "Testville",
      "Zip Code": "00000",
      "Home Phone Number": "555-0107",
      "Cell Phone Number": "555-0108",
      "Email Address": "bram@example.com",
      "T-shirt Size?": "M",
      "What is your ethnicity?": "Not Hispanic/Latino/Latina",
      "What is your race?": "White",
      "Parent/Guardian First Name": "Mel",
      "Parent/Guardian Last Name": "Example",
      "Parent/Guardian Relationship to Student": "Mother",
      "Parent/Guardian Cell Phone Number": "555-0107",
      "Parent/Guardian email address": "mel@example.com",
      "Parent/Guardian 2 (if applicable)": "Dave",
      "Parent/Guardian 2": "Example",
      "Parent/Guardian 2 Relationship to Student": "Father",
      "Parent/Guardian 2 Cell Phone Number": "555-0109",
      "Parent/Guardian 2 Email Address": "dave@example.com",
      "Please check all items of interest": "Electronics, Pneumatics",
      "Please check the boxes for any previous years you have participated as a student in FRC": "2023 Charged Up",
    });
    const csv = `${csvRow(HEADER_2024)}\n${row}`;
    const result = parseApplications(csv);

    expect(result.seasonYear).toBe(2024);
    const app = result.applications[0];
    expect(app.ethnicity).toBe("Not Hispanic/Latino/Latina");
    expect(app.race).toBe("White");
    expect(app.experiences).toEqual([{ level: "frc", year: 2023, name: "Charged Up" }]);
  });

  test("2025 header: trailing unlabeled column maps to dietaryRestrictions", () => {
    const row = rowFor(HEADER_2025, {
      Timestamp: "4/25/2024 21:19:31",
      "First Name": "Lyra",
      "Last Name": "Example",
      "Date of Birth": "9/19/0006",
      "What is your high school graduation year?": "2025",
      "What school are you attending for the 2024-2025 School Year?": "Test High School",
      "Street Address": "321 Test St",
      City: "Testville",
      "Zip Code": "00000",
      "Home Phone Number": "555-0110",
      "Cell Phone Number": "555-0111",
      "Email Address": "lyra@example.com",
      "T-shirt Size?": "S",
      "What is your ethnicity?": "Not Hispanic/Latino/Latina",
      "What is your race?": "White",
      "Parent/Guardian First Name": "Kim",
      "Parent/Guardian Last Name": "Example",
      "Parent/Guardian Relationship to Student": "Mother",
      "Parent/Guardian Cell Phone Number": "555-0110",
      "Parent/Guardian email address": "kim@example.com",
      "Parent/Guardian 2 (if applicable)": "Jon",
      "Parent/Guardian 2": "Example",
      "Parent/Guardian 2 Relationship to Student": "Father",
      "Parent/Guardian 2 Cell Phone Number": "555-0112",
      "Parent/Guardian 2 Email Address": "jon@example.com",
      "Please check all items of interest": "Graphic Design",
      "": "Peanut allergy",
    });
    const csv = `${csvRow(HEADER_2025)}\n${row}`;
    const result = parseApplications(csv);

    const app = result.applications[0];
    expect(app.dietaryRestrictions).toBe("Peanut allergy");
    // 9/19/0006 is a synthetic date-format edge case (implausible year, still parseable).
    expect(app.dob).toBe("0006-09-19");
    expect(result.anomalies).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "dob", detail: "implausible birth year", raw: "9/19/0006" })]),
    );
  });

  test("2027 header: guardian employer columns present for both guardians", () => {
    const row = rowFor(HEADER_2027, {
      Timestamp: "4/24/2026 15:58:11",
      "First Name": "Quinn",
      "Last Name": "Example",
      "Date of Birth": "7/12/2011",
      "What is your high school graduation year?": "2029",
      "What school are you attending for the 2026-2027 School Year?": "Test High School",
      "Street Address": "654 Example Ave",
      City: "Testville",
      "Zip Code": "00000",
      "Home Phone Number": "555-0113",
      "Cell Phone Number": "555-0114",
      "Email Address": "quinn@example.com",
      "T-shirt Size?": "L",
      "What is your ethnicity?": "Not Hispanic/Latino/Latina",
      "What is your race?": "White",
      "Parent/Guardian First Name": "Zeke",
      "Parent/Guardian Last Name": "Example",
      "Parent/Guardian Relationship to Student": "Father",
      "Parent/Guardian Cell Phone Number": "555-0113",
      "If applicable, parent/guardian's place of employment? ": "Acme Corp",
      "Parent/Guardian email address": "zeke@example.com",
      "Parent/Guardian 2 (if applicable)": "Kat",
      "Parent/Guardian 2": "Example",
      "Parent/Guardian 2 Relationship to Student": "Mother",
      "Parent/Guardian 2 Cell Phone Number": "555-0114",
      "Parent/Guardian 2 Email Address": "kat@example.com",
      "Parent/guardian 2 place of employment, if applicable.": "Beta LLC",
      "Please check all items of interest": "Build, Business Plan",
      "Please check the boxes for any previous years you have participated as a student in FLL Challenge": "2022-2023 Superpowered",
      "Please check the boxes for any previous years you have participated as a student in FTC": "2023-2024 Centerstage",
    });
    const csv = `${csvRow(HEADER_2027)}\n${row}`;
    const result = parseApplications(csv);

    const app = result.applications[0];
    expect(app.guardians[0]).toMatchObject({ firstName: "Zeke", lastName: "Example", employer: "Acme Corp" });
    expect(app.guardians[1]).toMatchObject({ firstName: "Kat", lastName: "Example", employer: "Beta LLC" });
  });
});

describe("parseApplications - experience parsing", () => {
  function buildCsv(experienceValues: Record<string, string>) {
    const row = rowFor(HEADER_2024, {
      Timestamp: "8/10/2023 21:50:12",
      "First Name": "Test",
      "Last Name": "Student",
      "Date of Birth": "5/1/2010",
      "What is your high school graduation year?": "2024",
      "What school are you attending for the 2023-2024 School Year?": "Test High School",
      ...experienceValues,
    });
    return `${csvRow(HEADER_2024)}\n${row}`;
  }

  test("range entry uses the second year", () => {
    const csv = buildCsv({
      "Please check the boxes for any previous years you have participated as a student in FLL Explore (Formerly FLL Jr.) (Do not check for mentoring a team)":
        "2017-2018 Relic Recovery",
    });
    const result = parseApplications(csv);
    expect(result.applications[0].experiences).toEqual(
      expect.arrayContaining([{ level: "fll_explore", year: 2018, name: "Relic Recovery" }]),
    );
  });

  test("single-year entry uses that year", () => {
    const csv = buildCsv({
      "Please check the boxes for any previous years you have participated as a student in FLL": "2016 Animal Allies",
    });
    const result = parseApplications(csv);
    expect(result.applications[0].experiences).toEqual(
      expect.arrayContaining([{ level: "fll_challenge", year: 2016, name: "Animal Allies" }]),
    );
  });

  test("unparseable entry produces an anomaly, not a crash", () => {
    const csv = buildCsv({
      "Please check the boxes for any previous years you have participated as a student in FTC": "garbage-entry",
    });
    const result = parseApplications(csv);
    expect(result.applications[0].experiences).toEqual([]);
    expect(result.anomalies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "experience:ftc", detail: "unparseable experience entry", raw: "garbage-entry" }),
      ]),
    );
  });
});

describe("parseApplications - guardian 2 header quirk", () => {
  test("Parent/Guardian 2 (if applicable) is first name; Parent/Guardian 2 is last name", () => {
    const row = rowFor(HEADER_2022, {
      Timestamp: "5/19/2021 16:05:09",
      "First Name": "Ada",
      "Last Name": "Lovelace",
      "Date of Birth": "8/7/2004",
      "What is your high school graduation year?": "2022",
      "What school are you attending for the 2021-2022 School Year?": "Test High School",
      "T-shirt Size?": "M",
      "Parent/Guardian First Name": "Pat",
      "Parent/Guardian Last Name": "Lovelace",
      "Parent/Guardian Relationship to Student": "Mother",
      "Parent/Guardian 2 (if applicable)": "Sam",
      "Parent/Guardian 2": "Lovelace",
      "Parent/Guardian 2 Relationship to Student": "Father",
      "Parent/Guardian 2 Cell Phone Number": "555-0103",
      "Parent/Guardian 2 Email Address": "sam@example.com",
      "Attended Call Out? ": "No",
    });
    const csv = `${csvRow(HEADER_2022)}\n${row}`;
    const result = parseApplications(csv);
    const [, g2] = result.applications[0].guardians;
    expect(g2.firstName).toBe("Sam");
    expect(g2.lastName).toBe("Lovelace");
  });
});

describe("parseApplications - phone normalization", () => {
  test("digits-only and N/A -> null", () => {
    const row = rowFor(HEADER_2024, {
      Timestamp: "8/10/2023 21:50:12",
      "First Name": "Test",
      "Last Name": "Student",
      "Date of Birth": "5/1/2010",
      "What is your high school graduation year?": "2024",
      "What school are you attending for the 2023-2024 School Year?": "Test High School",
      "Home Phone Number": "N/A",
      "Cell Phone Number": "(555) 010-0115",
    });
    const csv = `${csvRow(HEADER_2024)}\n${row}`;
    const app = parseApplications(csv).applications[0];
    expect(app.homePhone).toBeNull();
    expect(app.phone).toBe("5550100115");
  });
});

describe("parseApplications - gradYear", () => {
  test("4-digit grad year parses to an int", () => {
    const row = rowFor(HEADER_2024, {
      Timestamp: "8/10/2023 21:50:12",
      "First Name": "Test",
      "Last Name": "Student",
      "Date of Birth": "5/1/2010",
      "What is your high school graduation year?": "2024",
      "What school are you attending for the 2023-2024 School Year?": "Test High School",
    });
    const csv = `${csvRow(HEADER_2024)}\n${row}`;
    expect(parseApplications(csv).applications[0].gradYear).toBe(2024);
  });

  test("non-4-digit grad year yields null + anomaly", () => {
    const row = rowFor(HEADER_2024, {
      Timestamp: "8/10/2023 21:50:12",
      "First Name": "Test",
      "Last Name": "Student",
      "Date of Birth": "5/1/2010",
      "What is your high school graduation year?": "twenty-24",
      "What school are you attending for the 2023-2024 School Year?": "Test High School",
    });
    const csv = `${csvRow(HEADER_2024)}\n${row}`;
    const result = parseApplications(csv);
    expect(result.applications[0].gradYear).toBeNull();
    expect(result.anomalies).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "gradYear", raw: "twenty-24" })]),
    );
  });
});

describe("parseApplications - in-file dedup", () => {
  function buildDupCsv(timestamp1: string, timestamp2: string) {
    const common = {
      "First Name": "Dup",
      "Last Name": "Example",
      "Date of Birth": "5/1/2010",
      "What is your high school graduation year?": "2024",
      "What school are you attending for the 2023-2024 School Year?": "Test High School",
    };
    const row1 = rowFor(HEADER_2024, { Timestamp: timestamp1, ...common });
    const row2 = rowFor(HEADER_2024, { Timestamp: timestamp2, ...common });
    return `${csvRow(HEADER_2024)}\n${row1}\n${row2}`;
  }

  test("keeps the row with the newest submittedAt for a duplicate name+dob", () => {
    const csv = buildDupCsv("1/1/2024 10:00:00", "1/2/2024 10:00:00");
    const result = parseApplications(csv);
    expect(result.applications).toHaveLength(1);
    expect(result.applications[0].submittedAt).toBe(new Date("2024-01-02T10:00:00.000Z").toISOString());
  });

  test("preserves first-seen when the newer row's timestamp is unparseable", () => {
    const csv = buildDupCsv("1/1/2024 10:00:00", "not-a-date");
    const result = parseApplications(csv);
    expect(result.applications).toHaveLength(1);
    expect(result.applications[0].submittedAt).not.toBeNull();
  });
});

describe("nameKey", () => {
  test("lowercases and trims, joins with |", () => {
    expect(nameKey(" Ada ", "Lovelace")).toBe("ada|lovelace");
  });
});

describe("parseApplications - seasonYear extraction", () => {
  test("extracts the second year from the '20XX-20YY School Year' header", () => {
    const result = parseApplications(`${csvRow(HEADER_2027)}\n`);
    expect(result.seasonYear).toBe(2027);
  });
});
