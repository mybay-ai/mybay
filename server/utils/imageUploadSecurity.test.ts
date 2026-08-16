import { describe, expect, it } from "vitest";
import { detectSafeImageType, isDeclaredImageTypeCompatible } from "./imageUploadSecurity";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const webp = Buffer.from("RIFF0000WEBPVP8 ", "ascii");

describe("image upload content validation", () => {
  it.each([
    ["fake.png with JavaScript", Buffer.from("alert(1)"), "image/png"],
    ["image/png with non-PNG content", Buffer.from("not png"), "image/png"],
    ["../evil.png", Buffer.from("<script>"), "image/png"],
    ["evil.js with image/png", Buffer.from("console.log(1)"), "image/png"]
  ])("rejects %s", (_name, content, mime) => {
    const detected = detectSafeImageType(content);
    expect(detected && isDeclaredImageTypeCompatible(mime, detected)).toBeFalsy();
  });

  it.each([
    [png, "image/png", ".png"],
    [jpeg, "image/jpeg", ".jpg"],
    [webp, "image/webp", ".webp"]
  ])("accepts a valid image signature", (content, mime, extension) => {
    const detected = detectSafeImageType(content);
    expect(detected?.extension).toBe(extension);
    expect(detected && isDeclaredImageTypeCompatible(mime, detected)).toBe(true);
  });

  it("rejects a valid image when the declared MIME does not match", () => {
    const detected = detectSafeImageType(png)!;
    expect(isDeclaredImageTypeCompatible("image/jpeg", detected)).toBe(false);
  });
});