import { describe, expect, test } from "vitest";
import { HUB_URL, escapeHtml, renderEmail, type EmailInput } from "./email-template";

const FULL: EmailInput = {
  heading: "Your sign-in code",
  paragraphs: ["Enter this code on the 1741 Hub sign-in page. It expires in 10 minutes."],
  code: "1234-5678",
  footerNote: "If you didn't request this code, you can ignore this email.",
};

describe("renderEmail", () => {
  test("renders all fields into html and text", () => {
    const { html, text } = renderEmail(FULL);

    expect(html).toContain(FULL.heading);
    for (const p of FULL.paragraphs) expect(html).toContain(p);
    expect(html).toMatch(/letter-spacing:4px;">1234-5678</);
    expect(html).toContain(escapeHtml(FULL.footerNote!));
    expect(html).toContain(HUB_URL);
    expect(html).toContain(`src="${HUB_URL}/redalert-logo.png"`);
    expect(html).toContain('role="presentation"');
    expect(html).toContain('lang="en"');
    expect(html).toContain('name="color-scheme" content="dark"');

    expect(text).toContain(FULL.heading);
    for (const p of FULL.paragraphs) expect(text).toContain(p);
    expect(text).toContain(FULL.code!);
    expect(text).toContain(HUB_URL);
    expect(text).not.toContain("<");
  });

  test("escapes html but leaves text raw", () => {
    const input: EmailInput = {
      heading: '<b>&"x"</b>',
      paragraphs: ['<i>p</i>'],
      code: '<script>1</script>',
      footerNote: "a&b"
    };
    const { html, text } = renderEmail(input);

    expect(html).toContain("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;");
    expect(html).not.toContain('<b>&"x"</b>');
    expect(text).toContain('<b>&"x"</b>');

    expect(html).toContain("&lt;i&gt;p&lt;/i&gt;");
    expect(html).not.toContain("<i>");
    expect(text).toContain("<i>p</i>");

    expect(html).toContain("&lt;script&gt;1&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(text).toContain("<script>1</script>");

    expect(html).toContain("a&amp;b");
    expect(text).toContain("a&b");
  });

  test("omits the code block and footer note when absent", () => {
    const { html } = renderEmail({ heading: "Hi", paragraphs: ["body"] });

    expect(html).not.toContain("letter-spacing:4px");
    expect(html).not.toContain("didn't request");
  });
});

describe("escapeHtml", () => {
  test("escapes the five special characters", () => {
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });
});
