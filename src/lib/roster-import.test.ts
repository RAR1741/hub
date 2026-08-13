import { describe, expect, test } from "vitest";
import { parseRosterCsv } from "./roster-import";

describe("parseRosterCsv", () => {
  test("parses a valid multi-row CSV with case-insensitive, reordered headers", () => {
    const csv = [
      "Last_Name,First_Name,Email,Role,Grad_Year,Student_ID_Number",
      "Lovelace,Ada,ada@example.org,student,2028,1741",
      "Hopper,Grace,grace@example.org,mentor,,1742",
    ].join("\r\n");

    const { rows, errors } = parseRosterCsv(csv);

    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      line: 2,
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.org",
      role: "student",
      gradYear: 2028,
      studentIdNumber: "1741",
    });
    expect(rows[1]).toMatchObject({
      line: 3,
      firstName: "Grace",
      lastName: "Hopper",
      role: "mentor",
      gradYear: null,
      studentIdNumber: "1742",
    });
  });

  test("missing required first_name is a per-row error, not a thrown exception", () => {
    const csv = "first_name,last_name\n,Lovelace\n";
    const { rows, errors } = parseRosterCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toEqual([{ line: 2, message: expect.stringMatching(/first_name|last_name/i) }]);
  });

  test("missing required last_name is a per-row error", () => {
    const csv = "first_name,last_name\nAda,\n";
    const { rows, errors } = parseRosterCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0].line).toBe(2);
  });

  test("unknown role is a per-row error", () => {
    const csv = "first_name,last_name,role\nAda,Lovelace,superadmin\n";
    const { rows, errors } = parseRosterCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toEqual([{ line: 2, message: expect.stringMatching(/role/i) }]);
  });

  test("blank role defaults to student, but is flagged as not explicitly specified", () => {
    const csv = "first_name,last_name,role\nAda,Lovelace,\n";
    const { rows, errors } = parseRosterCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].role).toBe("student");
    expect(rows[0].roleWasSpecified).toBe(false);
  });

  test("an explicit role is flagged as specified", () => {
    const csv = "first_name,last_name,role\nAda,Lovelace,mentor\n";
    const { rows } = parseRosterCsv(csv);
    expect(rows[0].role).toBe("mentor");
    expect(rows[0].roleWasSpecified).toBe(true);
  });

  test("non-integer grad_year is a per-row error", () => {
    const csv = "first_name,last_name,grad_year\nAda,Lovelace,soon\n";
    const { rows, errors } = parseRosterCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toEqual([{ line: 2, message: expect.stringMatching(/grad_year/i) }]);
  });

  test("out-of-range grad_year is a per-row error (matches the admin form's 2000–2100 bound)", () => {
    const csv = "first_name,last_name,grad_year\nAda,Lovelace,20281\nBo,Peep,1899\n";
    const { rows, errors } = parseRosterCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toEqual([
      { line: 2, message: expect.stringMatching(/grad_year/i) },
      { line: 3, message: expect.stringMatching(/grad_year/i) },
    ]);
  });

  test("email is lowercased", () => {
    const csv = "first_name,last_name,email\nAda,Lovelace,ADA@EXAMPLE.ORG\n";
    const { rows, errors } = parseRosterCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].email).toBe("ada@example.org");
  });

  test("malformed email is a per-row error", () => {
    const csv = "first_name,last_name,email\nAda,Lovelace,not-an-email\n";
    const { rows, errors } = parseRosterCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toEqual([{ line: 2, message: expect.stringMatching(/email/i) }]);
  });

  test("in-file duplicate email produces an error for every conflicting line, and neither row is imported", () => {
    const csv = "first_name,last_name,email\nAda,Lovelace,dup@example.org\nAda,Two,DUP@example.org\n";
    const { rows, errors } = parseRosterCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.line).sort()).toEqual([2, 3]);
    expect(errors[0].message).toMatch(/duplicate/i);
  });

  test("in-file duplicate student_id_number produces an error for every conflicting line", () => {
    const csv = "first_name,last_name,student_id_number\nAda,Lovelace,1741\nGrace,Hopper,1741\n";
    const { rows, errors } = parseRosterCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.line).sort()).toEqual([2, 3]);
    expect(errors[0].message).toMatch(/duplicate/i);
  });

  test("empty input yields no rows and no errors", () => {
    expect(parseRosterCsv("")).toEqual({ rows: [], errors: [] });
  });

  test("header-only input yields no rows and no errors", () => {
    expect(parseRosterCsv("first_name,last_name\n")).toEqual({ rows: [], errors: [] });
  });

  test("unknown/extra columns are ignored, with a note, but the row still parses", () => {
    const csv = "first_name,last_name,favorite_color\nAda,Lovelace,red\n";
    const { rows, errors } = parseRosterCsv(csv);
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
    expect(errors[0].message).toMatch(/favorite_color/i);
  });

  test("handles quoted fields containing embedded commas", () => {
    const csv = 'first_name,last_name\nAda,"Lovelace, PhD"\n';
    const { rows, errors } = parseRosterCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].lastName).toBe("Lovelace, PhD");
  });

  test("handles escaped (doubled) quotes inside quoted fields", () => {
    const csv = 'first_name,last_name\n"Ann ""Annie""",Lee\n';
    const { rows, errors } = parseRosterCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].firstName).toBe('Ann "Annie"');
  });

  test("student_id_number is trimmed", () => {
    const csv = "first_name,last_name,student_id_number\nAda,Lovelace,  1741  \n";
    const { rows } = parseRosterCsv(csv);
    expect(rows[0].studentIdNumber).toBe("1741");
  });

  test("blank optional fields become null, not empty string", () => {
    const csv = "first_name,last_name,email,grad_year,student_id_number\nAda,Lovelace,,,\n";
    const { rows, errors } = parseRosterCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].email).toBeNull();
    expect(rows[0].gradYear).toBeNull();
    expect(rows[0].studentIdNumber).toBeNull();
  });
});
