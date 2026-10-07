import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEmail, passwordStrength, validateSignup } from "../validate.js";

test("accepts a normal email", () => assert.equal(validateEmail("ada@lovelace.dev"), true));
test("rejects an email without a domain", () => assert.equal(validateEmail("ada@"), false));
test("rejects an email with spaces", () => assert.equal(validateEmail("a da@x.io"), false));
test("short passwords are weak", () => assert.equal(passwordStrength("abc"), "weak"));
test("mixed passwords are strong", () => assert.equal(passwordStrength("Rocket#2026"), "strong"));
test("signup needs a name", () => assert.equal(validateSignup({ name: "", email: "a@b.co", password: "12345678" }).ok, false));
test("signup passes with good input", () =>
  assert.equal(validateSignup({ name: "Ada", email: "ada@lovelace.dev", password: "Rocket#2026" }).ok, true));
