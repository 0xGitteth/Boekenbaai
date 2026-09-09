from pathlib import Path

impl = Path('isbn-lookup-core-impl.js')
text = impl.read_text()

raw_block = """  const firstRawAlias = (...values) => {
    for (const value of values) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (typeof value === 'string' && !value.trim()) continue;
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      if (typeof value === 'object' && !Array.isArray(value)) {
        if (typeof value.value === 'string' && value.value.trim()) return value;
        const strings = toStringList(value);
        if (!strings.length) continue;
        return strings[0];
      }
      return value;
    }
    return undefined;
  };

"""
if raw_block not in text:
    raise SystemExit('firstRawAlias block not found')
text = text.replace(raw_block, '', 1)

old_desc = """  const descriptionValue = firstRawAlias(
    data.description,
    data.synopsis,
    data.summary,
  );
  const description = typeof descriptionValue === 'string'
    ? descriptionValue
    : descriptionValue?.value || '';
"""
new_desc = """  const description = firstAlias(
    data.description,
    data.synopsis,
    data.summary,
  );
"""
if old_desc not in text:
    raise SystemExit('description alias block not found')
text = text.replace(old_desc, new_desc, 1)

old_pages = """  const pageCount = numberFromValue(firstRawAlias(
    data.page_count,
    data.pages,
    data.number_of_pages,
  ));
"""
new_pages = """  const pageCount = numberFromValue(firstAlias(
    data.page_count,
    data.pages,
    data.number_of_pages,
  ));
"""
if old_pages not in text:
    raise SystemExit('page alias block not found')
impl.write_text(text.replace(old_pages, new_pages, 1))

test = Path('tests/isbn-wrapper-hardening.test.js')
text = test.read_text()
needle = "  assert.deepStrictEqual(aliasHeavy.tags, ['fantasy']);\n"
addition = """  assert.deepStrictEqual(aliasHeavy.tags, ['fantasy']);
  const arrayDescription = implDirect.parseIsbnBarcodeData({
    isbn,
    description: ['Beschrijving uit array'],
    page_count: [144],
  }, isbn);
  assert.strictEqual(
    arrayDescription.description,
    'Beschrijving uit array',
    'Array-valued description aliases must not be discarded',
  );
  assert.strictEqual(arrayDescription.pageCount, 144);
"""
if needle not in text:
    raise SystemExit('hardening test insertion point not found')
test.write_text(text.replace(needle, addition, 1))
