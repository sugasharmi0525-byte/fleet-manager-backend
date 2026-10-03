/** Rows-per-page choices offered by every paged list (?limit=); anything else falls back to the default. */
const PAGE_SIZES = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 10;

/** Reads ?page and ?limit from the query; returns limit/offset. */
function pageParams(query, pageSize = DEFAULT_PAGE_SIZE) {
  const limit = PAGE_SIZES.includes(Number(query.limit)) ? Number(query.limit) : pageSize;
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  return { page, limit, offset: (page - 1) * limit };
}

/** Standard list response: { rows, total, page, pages, limit }. */
function pageResult(rows, total, page, pageSize) {
  return { rows, total, page, pages: pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1, limit: pageSize };
}

module.exports = { PAGE_SIZES, DEFAULT_PAGE_SIZE, pageParams, pageResult };
