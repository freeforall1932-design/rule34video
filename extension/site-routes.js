// site-routes.js
// URL routing + listing parsers shared by the service worker, the side panel
// and the per-site content scripts.
//
// The extension only ever "fires" for URLs it recognises: every surface asks
// `R34Routes.match(url)` first and stays silent when the answer is `null`.
// This is what turns the old "one generic toolbar on both domains" behaviour
// into site- and page-specific behaviour:
//
//   rule34video.com                      rule34.world
//   ───────────────────────────────      ────────────────────────────────
//   video      /video/{id}/…             post       /post/{id}
//   home       /                         home       /
//   latest     /latest-updates[/N/]      tag        /{tag}[|{tag2}]   (?page=N)
//   search     /search/{q}[/]            hot        /hot, /highest, /trends
//   tag        /tags/{id}[/]             playlist   /playlists/view/{id}
//   category   /categories/{slug}[/]     playlists  /playlists
//   model      /models/{slug}[/]
//   member     /members/{id}[/…]
//   playlist   /playlists/{id}/{slug}[/]
//
// Also here: the page-range grammar from nh-dw ("2,4,6-10", "1-99", "all"),
// the rule34video.com listing-page scraper (cards + total page count) and the
// canonical page-URL builder used to crawl listing pages without a tab.
//
// Dependency-free, no chrome.*, no DOM: loaded as a classic script by the
// side panel and content scripts, imported by the ESM service worker, and
// unit-tested from source/tests/site-routes.test.mjs.

(function (root) {
  "use strict";

  const VIDEO_HOST = /(^|\.)rule34video\.com$/i;
  const WORLD_HOST = /(^|\.)rule34\.world$/i;

  function parseUrl(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    try {
      return new URL(text);
    } catch {
      return null;
    }
  }

  function decode(value) {
    try {
      return decodeURIComponent(String(value || "")).trim();
    } catch {
      return String(value || "").trim();
    }
  }

  // Page number from a "/N/" path suffix (rule34video) or a ?page= query
  // (rule34.world). Always >= 1.
  function positivePage(value) {
    const n = Number.parseInt(String(value || "").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  // Which site a URL belongs to: "video" | "world" | "".
  function siteOf(url) {
    const parsed = parseUrl(url);
    if (!parsed) return "";
    if (VIDEO_HOST.test(parsed.hostname)) return "video";
    if (WORLD_HOST.test(parsed.hostname)) return "world";
    return "";
  }

  // --- rule34video.com --------------------------------------------------------
  // Reserved first path segments that are NOT tag searches on rule34.world,
  // so "/hot" is a feed and "/touhou" is a tag.
  const WORLD_RESERVED = new Set([
    "post", "posts", "playlists", "playlist", "auth", "u", "user", "users", "comments",
    "announcements", "trends", "upgrade-to-premium", "api", "settings", "search",
    "tags", "tag", "feed", "bookmarks", "liked", "cum-history", "not-found", "admin",
  ]);

  function matchVideoSite(parsed) {
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const segments = path.split("/").filter(Boolean);
    const base = `${parsed.protocol}//${parsed.host}`;
    let match;

    if ((match = path.match(/^\/(?:video|videos|popup-video)\/(\d+)(?:\/([^/]*))?/i))) {
      // The site 404s on slug-less `/video/{id}/` URLs (verified 2026-09-03)
      // but redirects any slug to the real one, so the canonical URL keeps
      // the slug when we have it and pads with the id when we don't.
      const rawSlug = String(match[2] || "").trim();
      return {
        site: "video", kind: "video", id: match[1], slug: decode(rawSlug),
        listingUrl: "", page: 1, title: "", canonicalUrl: `${base}/video/${match[1]}/${rawSlug || match[1]}/`,
      };
    }
    if (segments.length === 0) {
      return { site: "video", kind: "home", id: "", page: 1, listingUrl: `${base}/latest-updates/`, title: "Latest updates", blockId: "custom_list_videos_most_recent_videos" };
    }
    if ((match = path.match(/^\/latest-updates(?:\/(\d+))?$/i))) {
      return { site: "video", kind: "latest", id: "", page: positivePage(match[1]), listingUrl: `${base}/latest-updates/`, title: "Latest updates", blockId: "custom_list_videos_most_recent_videos" };
    }
    if ((match = path.match(/^\/search\/([^/]+)(?:\/(\d+))?$/i))) {
      const query = decode(match[1]).replace(/\+/g, " ");
      return { site: "video", kind: "search", id: query, query, page: positivePage(match[2]), listingUrl: `${base}/search/${match[1]}/`, title: `Search: ${query}`, blockId: "custom_list_videos_videos_list_search", fromParam: "from_videos" };
    }
    if (path === "/search" && parsed.searchParams.get("q")) {
      const query = String(parsed.searchParams.get("q") || "").trim();
      return { site: "video", kind: "search", id: query, query, page: 1, listingUrl: `${base}/search/${encodeURIComponent(query)}/`, title: `Search: ${query}`, blockId: "custom_list_videos_videos_list_search", fromParam: "from_videos" };
    }
    if ((match = path.match(/^\/tags\/([^/]+)(?:\/(\d+))?$/i))) {
      return { site: "video", kind: "tag", id: decode(match[1]), page: positivePage(match[2]), listingUrl: `${base}/tags/${match[1]}/`, title: `Tag ${decode(match[1])}`, blockId: "custom_list_videos_common_videos" };
    }
    if ((match = path.match(/^\/categories\/([^/]+)(?:\/(\d+))?$/i))) {
      return { site: "video", kind: "category", id: decode(match[1]), page: positivePage(match[2]), listingUrl: `${base}/categories/${match[1]}/`, title: `Category ${decode(match[1])}`, blockId: "custom_list_videos_common_videos" };
    }
    if ((match = path.match(/^\/models\/([^/]+)(?:\/(\d+))?$/i))) {
      return { site: "video", kind: "model", id: decode(match[1]), page: positivePage(match[2]), listingUrl: `${base}/models/${match[1]}/`, title: `Artist ${decode(match[1])}`, blockId: "custom_list_videos_common_videos" };
    }
    if ((match = path.match(/^\/members\/(\d+)(?:\/([a-z_]+))?(?:\/(\d+))?$/i))) {
      const section = match[2] || "";
      const sectionPath = section ? `/${section}` : "";
      return { site: "video", kind: "member", id: match[1], page: positivePage(match[3]), listingUrl: `${base}/members/${match[1]}${sectionPath}/`, title: `Member ${match[1]}`, blockId: "list_videos_uploaded_videos", fromParam: "from_videos" };
    }
    if ((match = path.match(/^\/playlists\/(\d+)(?:\/([^/]+))?(?:\/(\d+))?$/i))) {
      return { site: "video", kind: "playlist", id: match[1], slug: decode(match[2] || ""), page: positivePage(match[3]), listingUrl: `${base}/playlists/${match[1]}/${match[2] || ""}`.replace(/\/$/, "") + "/", title: `Playlist ${decode(match[2] || match[1])}`, blockId: "playlist_view_playlist_view" };
    }
    if (path === "/playlists") {
      return { site: "video", kind: "playlists", id: "", page: 1, listingUrl: "", title: "Playlists" };
    }
    return null;
  }

  // --- rule34.world -----------------------------------------------------------
  function matchWorldSite(parsed) {
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const segments = path.split("/").filter(Boolean);
    const page = positivePage(parsed.searchParams.get("page"));
    // The listing URL keeps the user's filters (type=, sort=) but not the page,
    // so a crawl sees exactly what the user is looking at.
    const filters = new URLSearchParams();
    for (const key of ["type", "sort", "range"]) {
      const value = parsed.searchParams.get(key);
      if (value) filters.set(key, value);
    }
    const suffix = filters.toString() ? `?${filters.toString()}` : "";
    const base = `${parsed.protocol}//${parsed.host}`;
    let match;

    if ((match = path.match(/^\/post\/(\d+)/i))) {
      return { site: "world", kind: "post", id: match[1], page: 1, listingUrl: "", title: "", canonicalUrl: `${base}/post/${match[1]}` };
    }
    if (segments.length === 0) {
      return { site: "world", kind: "home", id: "", tags: [], page, listingUrl: `${base}/${suffix}`, title: "Home", mediaType: worldMediaType(parsed), sort: worldSort(parsed) };
    }
    if ((match = path.match(/^\/playlists\/view\/(\d+)$/i))) {
      return { site: "world", kind: "playlist", id: match[1], page, listingUrl: `${base}/playlists/view/${match[1]}`, title: `Playlist ${match[1]}` };
    }
    if (path === "/playlists") {
      return { site: "world", kind: "playlists", id: "", page, listingUrl: "", title: "Playlists" };
    }
    if (segments.length === 1 && /^(hot|highest|trends)$/i.test(segments[0])) {
      const feed = segments[0].toLowerCase();
      return { site: "world", kind: "feed", id: feed, tags: [], page, listingUrl: `${base}/${feed}${suffix}`, title: feed === "highest" ? "Highest rated" : feed === "hot" ? "Hot" : "Trends", feed, mediaType: worldMediaType(parsed), sort: worldSort(parsed) };
    }
    if (segments.length === 1 && !WORLD_RESERVED.has(segments[0].toLowerCase())) {
      // "/{tag}" or "/{tag1}|{tag2}" — underscores stand in for spaces.
      const raw = decode(segments[0]);
      const tags = raw.split("|").map((t) => t.replace(/_/g, " ").trim()).filter(Boolean);
      return { site: "world", kind: "tag", id: raw, tags, page, listingUrl: `${base}/${segments[0]}${suffix}`, title: tags.join(", "), mediaType: worldMediaType(parsed), sort: worldSort(parsed) };
    }
    return null;
  }

  // rule34.world filter query keys (from the SPA's urlQueryKeys): type=, sort=.
  function worldMediaType(parsed) {
    const value = String(parsed.searchParams.get("type") || "").toLowerCase();
    if (value === "image" || value === "images" || value === "0") return "image";
    if (value === "video" || value === "videos" || value === "1") return "video";
    return "all";
  }

  function worldSort(parsed) {
    return String(parsed.searchParams.get("sort") || "").toLowerCase();
  }

  // Main entry point. Returns null for anything the extension must ignore.
  function match(url) {
    const parsed = parseUrl(url);
    if (!parsed) return null;
    if (VIDEO_HOST.test(parsed.hostname)) return matchVideoSite(parsed);
    if (WORLD_HOST.test(parsed.hostname)) return matchWorldSite(parsed);
    return null;
  }

  // A listing = a page with many posts on it (anything that is not a single
  // post and not the playlists index).
  const LISTING_KINDS = new Set(["home", "latest", "search", "tag", "category", "model", "member", "playlist", "feed"]);

  function isListing(route) {
    return Boolean(route && LISTING_KINDS.has(route.kind));
  }

  function isSinglePost(route) {
    return Boolean(route && (route.kind === "video" || route.kind === "post"));
  }

  // --- page ranges (nh-dw grammar) -------------------------------------------
  // "2,4,6-10" -> [2,4,6,7,8,9,10]; "all" / "" -> every page 1..maxPage;
  // open ranges "5-" run to maxPage. A panel list is intentionally bounded:
  // fetching thousands of pages makes a huge, hard-to-review queue. Ask the
  // user to split a large listing into explicit batches instead of silently
  // truncating their requested range.
  const PAGE_RANGE_HARD_CAP = 150;

  function pageRangeLimitError() {
    return new Error(`Choose at most ${PAGE_RANGE_HARD_CAP} pages at a time. Fetch a large listing in separate batches, e.g. first 1-${PAGE_RANGE_HARD_CAP}, then ${PAGE_RANGE_HARD_CAP + 1}-${PAGE_RANGE_HARD_CAP * 2}.`);
  }

  function parsePageRange(input, maxPage) {
    const text = String(input === undefined || input === null ? "" : input).trim().toLowerCase();
    const limit = Number.isFinite(Number(maxPage)) && Number(maxPage) > 0 ? Math.floor(Number(maxPage)) : 0;
    const pages = new Set();
    const add = (n) => {
      if (n < 1 || (limit && n > limit) || pages.has(n)) return;
      if (pages.size >= PAGE_RANGE_HARD_CAP) throw pageRangeLimitError();
      pages.add(n);
    };
    if (!text || text === "all" || text === "*") {
      if (!limit) throw new Error("The total number of pages is unknown — enter an explicit range such as 1-20.");
      if (limit > PAGE_RANGE_HARD_CAP) throw pageRangeLimitError();
      for (let n = 1; n <= limit; n += 1) add(n);
      return Array.from(pages);
    }
    for (const rawPart of text.split(/[,\s;]+/)) {
      const part = rawPart.trim();
      if (!part) continue;
      let m;
      if ((m = part.match(/^(\d+)$/))) {
        add(Number(m[1]));
        continue;
      }
      if ((m = part.match(/^(\d+)\s*-\s*(\d*)$/))) {
        const start = Number(m[1]);
        const requestedEnd = m[2] === "" ? limit : Number(m[2]);
        if (m[2] === "" && !limit) throw new Error(`"${part}" needs an end page because the total is unknown.`);
        if (!Number.isFinite(start) || start < 1) throw new Error(`Bad page "${part}".`);
        if (requestedEnd < start) throw new Error(`"${part}": the end page is before the start page.`);
        // A known page count still clamps an oversized endpoint as advertised;
        // only the number of pages that would actually be fetched is capped.
        const end = limit ? Math.min(requestedEnd, limit) : requestedEnd;
        if (end >= start && end - start + 1 > PAGE_RANGE_HARD_CAP) throw pageRangeLimitError();
        for (let n = start; n <= end; n += 1) add(n);
        continue;
      }
      throw new Error(`Cannot read "${part}". Use numbers and ranges, e.g. 2,4,6-10 or 1-99.`);
    }
    if (!pages.size) throw new Error("No pages selected.");
    return Array.from(pages).sort((a, b) => a - b);
  }

  // --- rule34video.com listing pages -----------------------------------------
  // Cards on every listing page are `div.item.thumb[data-video-card-id]` with
  // `a.th[href*="/video/{id}/"][title]` inside, a `div.time` duration and a
  // lazy `img.thumb[data-original]`. Playlist pages use plain `a[href*="/video/"]`
  // rows. Parsing with regexes keeps this usable in the service worker (no DOM).
  function decodeEntities(value) {
    return String(value || "")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#039;|&apos;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
  }

  function parseVideoListing(html, baseUrl) {
    let text = String(html || "");
    const base = String(baseUrl || "https://rule34video.com/");
    const items = [];
    const seen = new Set();
    // Listing pages also carry "Top videos today" / related sidebars with the
    // same card markup. When the page has a main list block, parse only that.
    const main = text.match(/<div[^>]+id="(?:custom_list_videos_[a-z_]+|list_videos_[a-z_]+|playlist_view_playlist_view)_items"[^>]*>([\s\S]*?)(?:<div class="pagination"|<\/div>\s*<div class="pagination"|<div id="[a-z_]+_pagination")/i);
    if (main && main[1] && /\/video\/\d+/.test(main[1])) text = main[1];
    const anchorPattern = /<a\b[^>]*href="([^"]*\/video\/(\d+)\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = anchorPattern.exec(text)) !== null) {
      const id = m[2];
      if (seen.has(id)) continue;
      const href = decodeEntities(m[1]);
      const inner = m[3];
      const attrs = m[0].slice(0, m[0].indexOf(">") + 1);
      const titleAttr = attrs.match(/\btitle="([^"]*)"/i);
      const thumb = inner.match(/\bdata-original="([^"]+)"/i) || inner.match(/\bdata-webp="([^"]+)"/i) || inner.match(/<img[^>]+src="(https?:[^"]+)"/i);
      const duration = inner.match(/class="time"[^>]*>\s*([^<]+?)\s*</i);
      const innerTitle = inner.match(/class="thumb_title"[^>]*>\s*([^<]+?)\s*</i) || inner.match(/<img[^>]+alt="([^"]*)"/i);
      const title = decodeEntities((titleAttr && titleAttr[1]) || (innerTitle && innerTitle[1]) || "").trim();
      // Sidebar/related links have neither a title attribute nor a thumbnail:
      // they are navigation, not cards.
      if (!title && !thumb) continue;
      seen.add(id);
      let url = href;
      try { url = new URL(href, base).href; } catch {}
      items.push({
        id,
        url: url.replace(/#.*$/, ""),
        title: title || `Video ${id}`,
        thumbnail: thumb ? decodeEntities(thumb[1]) : "",
        duration: duration ? duration[1].trim() : "",
        type: "video",
      });
    }
    return items;
  }

  // Highest page number linked from the pagination block ("Last" carries the
  // real total). 0 when the page has no pagination.
  function parseVideoListingPageCount(html) {
    const text = String(html || "");
    let max = 0;
    const paginationBlocks = text.match(/<div class="pagination"[\s\S]*?<\/div>\s*<\/div>/gi) || [text];
    for (const block of paginationBlocks) {
      for (const m of block.matchAll(/data-parameters="[^"]*from(?:_videos|_albums)?:0*(\d+)/gi)) {
        max = Math.max(max, Number(m[1]));
      }
      for (const m of block.matchAll(/href="[^"]*\/(\d+)\/?(?:#[^"]*)?"[^>]*>\s*(?:\d+|Last|»|&raquo;)\s*</gi)) {
        max = Math.max(max, Number(m[1]));
      }
    }
    // Some listings only expose the count as "Page N" of "(total)". Fall back
    // to the visible numbered links.
    if (!max) {
      for (const m of text.matchAll(/class="item[^"]*"[^>]*>\s*<a[^>]*>\s*0*(\d+)\s*</gi)) {
        max = Math.max(max, Number(m[1]));
      }
    }
    return max;
  }

  // Total result count from the listing heading, e.g. "Videos for: touhou (2,072)".
  function parseVideoListingTotal(html) {
    const m = String(html || "").match(/<h1[^>]*>[\s\S]*?\(\s*([\d,.\s]+)\s*\)[\s\S]*?<\/h1>/i)
      || String(html || "").match(/Videos<\/span>\s*<span[^>]*>\s*([\d,.\s]+)\s*</i);
    if (!m) return 0;
    const n = Number(String(m[1]).replace(/[^\d]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  // Fully rendered page URL for page N of a listing. An older version used
  // KVS's undocumented `mode=async&function=get_block` endpoint here. That
  // endpoint now replies HTTP 500 for extension fetches, so page 2+ never
  // reached the queue even though the normal `/.../2/` page works. Fetch the
  // same canonical pages a browser navigation uses instead.
  function videoListingPageUrl(route, page) {
    return videoListingPageHref(route, page);
  }

  // Human-readable page URL (what the user would see in the address bar).
  function videoListingPageHref(route, page) {
    const n = positivePage(page);
    if (!route || !route.listingUrl) return "";
    if (n === 1) return route.listingUrl;
    return `${route.listingUrl.replace(/\/$/, "")}/${n}/`;
  }

  // --- rule34.world helpers ----------------------------------------------------
  const WORLD_PAGE_SIZE = 30; // the SPA's posts.default.pageSize
  const WORLD_CDN = "https://rule34storage.b-cdn.net";

  function worldThumbnail(id) {
    const n = Number(id);
    if (!Number.isFinite(n)) return "";
    return `${WORLD_CDN}/posts/${Math.floor(n / 1000)}/${n}/${n}.pic256.jpg`;
  }

  function worldPostUrl(id) {
    return `https://rule34.world/post/${id}`;
  }

  // The search body the SPA posts to /api/v2/post/search/root for a listing
  // route + page. Live capture (2026-09-04) shows the API reads ONLY these
  // (lowercase) keys — the old `{ Skip, CountTotal, IncludeLinks, OrderBy }`
  // casing was ignored by the server, so every "page" came back as page 1.
  // `sortBy` maps the SPA's sort query; media filtering is NOT sent here (the
  // panel filters rows by type after listing, and the SPA's own pics/videos
  // field is unconfirmed), so `filterAi:false` and the tag list are kept and
  // no `type` key is added. `cursor` is optional: pass the previous response's
  // `cursor` (the last post id) to page past it — the API is a keyset feed.
  function worldSearchBody(route, page, options) {
    const size = Number(options?.pageSize) > 0 ? Number(options.pageSize) : WORLD_PAGE_SIZE;
    const n = positivePage(page);
    const body = {
      skip: (n - 1) * size,
      take: size,
      countTotal: false,
      checkHasMore: true,
      filterAi: false,
      sortBy: worldOrderBy(route?.sort),
      includeTags: Array.isArray(route?.tags) ? route.tags : [],
    };
    const cursor = String(options?.cursor || "").trim();
    if (cursor) body.cursor = cursor;
    return body;
  }

  // Sort names in the SPA URL -> OrderBy ids (0 = latest, the API default).
  function worldOrderBy(sort) {
    switch (String(sort || "").toLowerCase()) {
      case "top": case "top-rated": case "rated": return 1;
      case "views": case "most-viewed": case "viewed": return 2;
      case "shuffle": case "random": return 3;
      case "oldest": return 4;
      default: return 0;
    }
  }

  // Page url the user would see for a world listing.
  function worldListingPageHref(route, page) {
    if (!route || !route.listingUrl) return "";
    const url = new URL(route.listingUrl);
    const n = positivePage(page);
    if (n > 1) url.searchParams.set("page", String(n));
    else url.searchParams.delete("page");
    return url.href;
  }

  const api = {
    VIDEO_HOST,
    WORLD_HOST,
    WORLD_PAGE_SIZE,
    PAGE_RANGE_HARD_CAP,
    siteOf,
    match,
    isListing,
    isSinglePost,
    parsePageRange,
    decodeEntities,
    parseVideoListing,
    parseVideoListingPageCount,
    parseVideoListingTotal,
    videoListingPageUrl,
    videoListingPageHref,
    worldThumbnail,
    worldPostUrl,
    worldSearchBody,
    worldOrderBy,
    worldListingPageHref,
  };

  try {
    root.R34Routes = api;
  } catch {}
})(typeof globalThis !== "undefined" ? globalThis : this);
