from pathlib import Path

# Apply the reviewed product patch plus the exact-evidence fixture updates.
exec(Path('.github/scripts/isbn_self_review_v6.py').read_text(), {'__name__': '__main__'})

path = Path('tests/import.test.js')
text = path.read_text()
old = """    assert.strictEqual(scenario1.author, 'Carry Slee');
    assert.strictEqual(scenario1.importInfo?.process?.fallbackUsed, true);
    assert.strictEqual(scenario1.importInfo?.process?.lookupSource, 'mock');
    assert.strictEqual(
      scenario1.importInfo?.process?.fallbackSource,
      'mock-title-author',
      'Fallback provenance must identify the actual title/author fallback source',
    );
"""
new = """    assert.strictEqual(scenario1.author, 'Carry Slee');
    const scenario1ImportInfo = await request(`/api/books/${scenario1.id}/import-info`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(scenario1ImportInfo.status, 200);
    assert.strictEqual(scenario1ImportInfo.body?.process?.fallbackUsed, true);
    assert.strictEqual(scenario1ImportInfo.body?.process?.lookupSource, 'mock');
    assert.strictEqual(
      scenario1ImportInfo.body?.process?.fallbackSource,
      'mock-title-author',
      'Fallback provenance must identify the actual title/author fallback source shown to admins',
    );
"""
if old not in text:
    raise SystemExit('missing temporary provenance assertions from v5')
text = text.replace(old, new, 1)
path.write_text(text)
