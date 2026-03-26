function rewriteLegacyOpenLibraryArchiveCoverUrl(value) {
  if (value === undefined || value === null) {
    return value;
  }
  const text = String(value).trim();
  if (!text) {
    return text;
  }
  const match = text.match(
    /^(?:https?:\/\/)?(?:www\.)?archive\.org\/download\/[^?#]+\/(\d+)-([sml])\.jpg(?:\?[^#]*)?(?:#.*)?$/i,
  );
  if (!match) {
    return text;
  }
  const coverId = Number.parseInt(match[1], 10);
  if (!Number.isInteger(coverId) || coverId <= 0) {
    return text;
  }
  const size = String(match[2] || '').toUpperCase();
  if (size !== 'S' && size !== 'M' && size !== 'L') {
    return text;
  }
  return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg?default=false`;
}

module.exports = {
  rewriteLegacyOpenLibraryArchiveCoverUrl,
};
