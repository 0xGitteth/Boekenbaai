from pathlib import Path

# Apply the already-reviewed product patch first.
exec(Path('.github/scripts/isbn_self_review_v5.py').read_text(), {'__name__': '__main__'})

# Existing Open Library cover-ID regressions must now carry exact ISBN evidence,
# because the parser deliberately no longer treats the request URL alone as proof.
path = Path('tests/isbn-review-regressions.test.js')
text = path.read_text()
old_one = """  const openLibrary = parseOpenLibraryData({
    title: 'Test',
    authors: [{ name: 'Auteur' }],
    covers: [-1, 0, 1.5, 55],
  }, isbn);"""
new_one = """  const openLibrary = parseOpenLibraryData({
    isbn_13: [isbn],
    title: 'Test',
    authors: [{ name: 'Auteur' }],
    covers: [-1, 0, 1.5, 55],
  }, isbn);"""
if old_one not in text:
    raise SystemExit('missing Open Library valid-cover regression fixture')
text = text.replace(old_one, new_one, 1)

old_two = "parseOpenLibraryData({ title: 'Test', authors: [{ name: 'Auteur' }], covers: [-1, 0, 1.5] }, isbn).coverUrl"
new_two = "parseOpenLibraryData({ isbn_13: [isbn], title: 'Test', authors: [{ name: 'Auteur' }], covers: [-1, 0, 1.5] }, isbn).coverUrl"
if old_two not in text:
    raise SystemExit('missing Open Library invalid-cover regression fixture')
text = text.replace(old_two, new_two, 1)
path.write_text(text)
