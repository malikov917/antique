import { parsePhoneNumberFromString } from "libphonenumber-js";
import { AuthError } from "./errors.js";

export function normalizePhoneNumber(phone: string): string {
  const parsed = parsePhoneNumberFromString(phone, "US");
  if (!parsed || !parsed.isValid()) {
    throw new AuthError("invalid_phone", "Phone number is invalid", 400);
  }
  return parsed.number;
}
