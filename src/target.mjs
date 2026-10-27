// Targets: one string names one element. Playwright selector syntax plus four shorthands:
//   text=Sign in · text="Sign in" (exact) · role=button[name="Launch"] · label=Email · placeholder=you@x.com
//   testid=card · alt=Logo · title=Close · css=.card or bare CSS · //xpath · chain with " >> ", e.g. "role=row >> nth=2"
const BY = { "label=": "getByLabel", "placeholder=": "getByPlaceholder", "testid=": "getByTestId", "alt=": "getByAltText", "title=": "getByTitle" };

const unquote = (s) => (/^".*"$/.test(s) ? { text: s.slice(1, -1), exact: true } : { text: s, exact: false });

/** The Locator for a target string. Throws on an empty target. */
export function toLocator(page, target) {
  if (typeof target !== "string" || !target.trim()) throw new Error(`a target must be a non-empty string, got ${JSON.stringify(target)}`);
  const [head, ...rest] = target.split(" >> ");
  const prefix = Object.keys(BY).find((p) => head.startsWith(p));
  if (!prefix) return page.locator(target);
  const { text, exact } = unquote(head.slice(prefix.length));
  const base = prefix === "testid=" ? page[BY[prefix]](text) : page[BY[prefix]](text, { exact });
  return rest.length ? base.locator(rest.join(" >> ")) : base;
}
