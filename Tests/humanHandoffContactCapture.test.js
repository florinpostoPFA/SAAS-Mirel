"use strict";

const { parsePhone, parseEmail, parseContact } = require("../services/handoff/contactParser");

describe("contactParser", () => {
  describe("parsePhone (strict)", () => {
    it.each([
      "0744123456",
      "+40 744 123 456",
      "0744-123-456",
      "0744 123 456"
    ])("accepts %s", (input) => {
      expect(parsePhone(input)).not.toBeNull();
      expect(parsePhone(input).type).toBe("phone");
    });

    it.each(["12345", "order 07441234567x", "abc"])("rejects invalid %s", (input) => {
      expect(parsePhone(input)).toBeNull();
    });
  });

  describe("parsePhone (loose)", () => {
    it("accepts compact digit runs on retry", () => {
      expect(parsePhone("0744123456", { loose: true })).not.toBeNull();
    });
  });

  describe("parseEmail", () => {
    it.each(["florin@posto.ro", "florin.posto@gmail.com"])("accepts %s", (email) => {
      expect(parseEmail(email)?.value).toBe(email.toLowerCase());
    });

    it("rejects malformed email", () => {
      expect(parseEmail("not-an-email")).toBeNull();
    });
  });

  describe("parseContact", () => {
    it("prefers email over phone-like substring", () => {
      const r = parseContact("florin@posto.ro");
      expect(r.type).toBe("email");
    });
  });
});
