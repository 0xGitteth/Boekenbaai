from pathlib import Path

impl_path = Path('isbn-lookup-core-impl.js')
impl = impl_path.read_text()

old_parse = r'''function parseNurTags(fragment) {
  const anchors = Array.from(String(fragment || '').matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi))
    .map((entry) => stripHtml(entry[1]).replace(/^\d{3}\s+/, '').trim().toLowerCase())
    .filter(Boolean);
  if (anchors.length) return Array.from(new Set(anchors));

  const plain = stripHtml(fragment);
  const values = [];
  for (const match of plain.matchAll(/(?:^|\s)\d{3}\s+(.+?)(?=\s+\d{3}\s+|$)/g)) {
    const label = String(match[1] || '').trim().toLowerCase();
    if (label) values.push(label);
  }
  return Array.from(new Set(values));
}'''

new_parse = r'''function parseNurTags(fragment) {
  const anchors = Array.from(String(fragment || '').matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi))
    .flatMap((entry) => {
      const text = stripHtml(entry[1]);
      const match = text.match(/^\d{3}\s+(.+)$/);
      const label = String(match?.[1] || '').trim().toLowerCase();
      return label ? [label] : [];
    });
  if (anchors.length) return Array.from(new Set(anchors));

  const plain = stripHtml(fragment);
  const values = [];
  for (const match of plain.matchAll(/(?:^|\s)\d{3}\s+(.+?)(?=\s+\d{3}\s+|$)/g)) {
    const label = String(match[1] || '').trim().toLowerCase();
    if (label) values.push(label);
  }
  return Array.from(new Set(values));
}'''

if old_parse not in impl:
    raise SystemExit('parseNurTags block not found')
impl = impl.replace(old_parse, new_parse, 1)

old_extract = r'''function extractCbEditionNurTags(block) {
  const match = String(block || '').match(
    /<span>\s*NUR\s*<\/span>([\s\S]*?)(?=<span>|$)/i,
  );
  return match ? parseNurTags(match[1]) : [];
}'''

new_extract = r'''function extractCbEditionNurTags(block) {
  const source = String(block || '');
  const nurMarker = /<span>\s*NUR\s*<\/span>/i;
  const marker = nurMarker.exec(source);
  if (!marker) return [];

  // NUR lives in the edition's hidden pd-block. The final edition block may
  // extend to the end of the document, so first isolate that pd-block instead
  // of allowing footer/navigation anchors to leak into edition classifications.
  const prefix = source.slice(0, marker.index);
  const pdOpenings = Array.from(prefix.matchAll(
    /<div\b[^>]*class=["'][^"']*\bpd-block\b[^"']*["'][^>]*>/gi,
  ));
  const pdOpening = pdOpenings[pdOpenings.length - 1];

  let scoped = source;
  if (pdOpening) {
    const divPattern = /<\/?div\b[^>]*>/gi;
    divPattern.lastIndex = pdOpening.index;
    let depth = 0;
    let end = source.length;
    let divMatch;
    while ((divMatch = divPattern.exec(source))) {
      if (/^<\//.test(divMatch[0])) depth -= 1;
      else depth += 1;
      if (depth === 0) {
        end = divPattern.lastIndex;
        break;
      }
    }
    const candidate = source.slice(pdOpening.index, end);
    if (nurMarker.test(candidate)) scoped = candidate;
  }

  const scopedMarker = nurMarker.exec(scoped);
  if (!scopedMarker) return [];
  let fragment = scoped.slice(scopedMarker.index + scopedMarker[0].length);
  const nextSpan = fragment.search(/<span\b/i);
  if (nextSpan >= 0) fragment = fragment.slice(0, nextSpan);

  if (!pdOpening) {
    const closingDiv = fragment.search(/<\/div\s*>/i);
    if (closingDiv >= 0) fragment = fragment.slice(0, closingDiv);
  }

  return parseNurTags(fragment);
}'''

if old_extract not in impl:
    raise SystemExit('extractCbEditionNurTags block not found')
impl = impl.replace(old_extract, new_extract, 1)
impl_path.write_text(impl)

test_path = Path('tests/isbn-wrapper-hardening.test.js')
test = test_path.read_text()
anchor = """  const sparseCb = parseCbDetailHtml(sparseCbHtml, isbn);\n  assert.ok(sparseCb?.found, 'An exact CB edition block must stay found even when work metadata is sparse');\n  assert.strictEqual(sparseCb.language, 'en');\n  assert.strictEqual(sparseCb.coverUrl, 'https://cdn.example.test/exact-cover.jpg');\n  assert.deepStrictEqual(\n    sparseCb.tags,\n    ['puzzelboeken'],\n    'Exact-edition NUR tags must win over broader work-level NUR tags when present',\n  );\n"""
addition = anchor + """\n  const terminalNurHtml = [\n    '<div class=\"uitv\">',\n    `<span>ISBN</span><br>${isbn}<br><br>`,\n    '<div class=\"hidden pd-block\">',\n    '<span>NUR</span>',\n    '<div><a>493 Puzzelboeken</a><br><a>494 Spelen, spelletjes</a></div>',\n    '</div>',\n    '</div>',\n    '<footer>',\n    '<a href=\"/footer\">Navigatie zonder NUR</a>',\n    '<a href=\"/coded-footer\">123 Footer die op een NUR lijkt</a>',\n    '</footer>',\n  ].join('');\n  const terminalNur = parseCbDetailHtml(terminalNurHtml, isbn);\n  assert.ok(terminalNur?.found);\n  assert.deepStrictEqual(\n    terminalNur.tags,\n    ['puzzelboeken', 'spelen, spelletjes'],\n    'The last edition NUR field must stop at its pd-block and never absorb footer anchors',\n  );\n"""
if anchor not in test:
    raise SystemExit('sparse CB test anchor not found')
test = test.replace(anchor, addition, 1)
test_path.write_text(test)
