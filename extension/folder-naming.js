// folder-naming.js
// Source-separated, tag-named output folders.
//
// Every download lands in `Downloads/<Root>/<Site>/<Collection>/<file>`:
//   <Root>       one configurable master folder (default "R34V"; the EMPTY
//                STRING disables it and restores the flat pre-feature layout;
//                slashes nest deeper)
//   <Site>       derived AUTOMATICALLY from the hostname/adapter that served
//                the post (hostname -> short slug), so files from the two
//                supported sites are never mixed and the user types nothing
//   <Collection> the tag/artist folder, built from a template string such as
//                "{artist} - {title} - {id}", or typed by hand, or taken from
//                the search the download started from
//
// The only mechanism used is `chrome.downloads.download({ filename })`, which
// takes a RELATIVE subpath and auto-creates the folders inside the fixed
// download location without prompts. Absolute paths and ".." are impossible by
// construction: every segment is sanitized (see sanitizeArtifactFilename).
//
// This file is deliberately dependency-free and side-effect free: it is loaded
// as a classic script by popup.html and imported by the service worker
// (background-enhanced.js), and it is exercised directly by the offline test
// suites in source/tests/. No chrome.*, no DOM.

(function (root) {
  "use strict";

  // --- master folder -------------------------------------------------------
  // One top-level folder that collects every download from this extension.
  // An explicit empty/whitespace-only value turns it OFF (the historical
  // layout); undefined/null means "use the default".
  const DEFAULT_MASTER_FOLDER = "R34V";

  function normalizeMasterFolder(value) {
    if (value === undefined || value === null) return DEFAULT_MASTER_FOLDER;
    return String(value).trim();
  }

  // --- source map: hostname -> short slug ---------------------------------
  // Keys are matched against the page hostname (lowercased, "www." stripped)
  // and, as a fallback, against the whole URL so a media-only URL still lands
  // in the right site folder.
  const SITE_SLUG_BY_HOST = {
    "rule34video.com": "rule34video",
    "rule34.world": "rule34world",
    "rule34.xyz": "rule34world",
    "rule34storage.b-cdn.net": "rule34world",
  };

  const KNOWN_SITE_SLUGS = Array.from(new Set(Object.values(SITE_SLUG_BY_HOST)));

  function hostnameOf(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    try {
      if (/^https?:\/\//i.test(text)) return new URL(text).hostname.toLowerCase();
    } catch {}
    // Bare hostnames ("rule34.world") are accepted too.
    if (/^[\w.-]+\.[a-z]{2,}$/i.test(text)) return text.toLowerCase();
    return "";
  }

  // Which site served this post. Unknown hosts fall back to their sanitized
  // hostname (dots -> "-") so a future site still gets its own folder instead
  // of silently merging into another site's.
  function siteSlugForUrl(url) {
    const text = String(url || "").trim();
    // Idempotent: an already-resolved slug passes straight through, so callers
    // (the popup preview, the service worker) can hand over either a page URL
    // or the slug they computed earlier.
    if (KNOWN_SITE_SLUGS.includes(text)) return text;
    const host = hostnameOf(text);
    if (!host) return "unknown-site";
    const bare = host.replace(/^www\./, "");
    if (SITE_SLUG_BY_HOST[bare]) return SITE_SLUG_BY_HOST[bare];
    for (const [known, slug] of Object.entries(SITE_SLUG_BY_HOST)) {
      if (bare === known || bare.endsWith("." + known)) return slug;
    }
    return sanitizeSegment(bare.replace(/\./g, "-"), "") || "unknown-site";
  }

  // --- path/filename sanitizing -------------------------------------------
  const MAX_SEGMENT_LENGTH = 120;
  // Chrome/Windows reject these outright; the rest is cosmetic.
  const WINDOWS_RESERVED_NAMES = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
  ]);

  // Make a downloads-API filename safe enough that Chrome never discards it:
  // keep the subfolder structure (a/b/c.jpg), strip control and reserved
  // characters per segment, drop leading dots and trailing dots/spaces
  // (Windows rejects those), bound segment length, and fall back to the post
  // name when nothing usable is left. This runs right before
  // chrome.downloads.download for every artifact (videos, archives, PDFs,
  // loose pages). Ported verbatim from the sister project's
  // sanitizeArtifactFilename (nh-dw-2.0 src/background/Downloader.ts).
  // The per-segment rules, on their own, so a single folder name can be
  // cleaned without the path-level splitting below.
  function cleanSegment(segment) {
    let cleaned = String(segment === undefined || segment === null ? "" : segment)
      .replace(/[\x00-\x1f\x7f]/g, "")
      .replace(/[\\:*?"<>|]/g, "")
      .replace(/^\.+/, "")
      .replace(/[. ]+$/g, "");
    if (cleaned.length > MAX_SEGMENT_LENGTH) {
      cleaned = cleaned.slice(0, MAX_SEGMENT_LENGTH).replace(/[. ]+$/g, "");
    }
    // Stripping a character can leave a dangling separator behind (a title of
    // "***" inside "{artist} - {title} - {id}" would otherwise produce a
    // folder called " - 4573905"), so the edges are tidied last.
    return cleaned.replace(/^[ ,\-.()\s]+/, "").replace(/[ ,\-.()\s]+$/, "");
  }

  function sanitizeArtifactFilename(filename, fallbackStem) {
    const segments = String(filename).split("/");
    const cleanedSegments = [];
    for (const segment of segments) {
      const cleaned = cleanSegment(segment);
      if (cleaned !== "") {
        cleanedSegments.push(cleaned);
      }
    }
    let joined = cleanedSegments.join("/");
    if (joined === "" || joined === "/") {
      joined = sanitizeArtifactFilename(String(fallbackStem || "download"), "download");
    }
    return joined;
  }

  // Windows reserves a handful of device names regardless of extension
  // (CON, PRN, COM1, LPT9, ...). Prefix them so Chrome can still save the
  // entry instead of failing silently.
  function prefixReservedWindowsName(segment) {
    const value = String(segment || "");
    if (!value) return value;
    const stem = value.replace(/\.[^.]*$/, "");
    if (WINDOWS_RESERVED_NAMES.has(value.toUpperCase()) || WINDOWS_RESERVED_NAMES.has(stem.toUpperCase())) {
      return "_" + value;
    }
    return value;
  }

  // Clean ONE path segment. A separator typed inside the value (a manual tag
  // like "art/touhou") becomes a dash rather than a new folder level, so the
  // caller's single-segment contract always holds.
  function sanitizeSegment(value, fallback) {
    const parts = String(value === undefined || value === null ? "" : value)
      .split("/")
      .map(cleanSegment)
      .filter(Boolean);
    const single = parts.length ? prefixReservedWindowsName(parts.join("-")) : "";
    if (single) return single;
    return prefixReservedWindowsName(cleanSegment(fallback)) || "untagged";
  }

  // Full relative path: sanitize every segment (user-typed master folder,
  // tag-derived collection, title-derived file name), prefix reserved names,
  // and never allow the result to start with "/" (absolute) or contain "..".
  function safeRelativePath(relativePath, fallbackStem) {
    const cleaned = sanitizeArtifactFilename(relativePath, fallbackStem);
    const segments = cleaned.split("/").map(prefixReservedWindowsName).filter(Boolean);
    if (!segments.length) return sanitizeArtifactFilename(fallbackStem || "download", "download");
    return segments.join("/");
  }

  // --- collection-name template engine ------------------------------------
  // The stored value stays a plain placeholder string ("{artist} - {id}"), so
  // the download engine and any previously saved template keep working. The
  // popup renders one checkbox per token and rebuilds the string from the
  // checked boxes, in this canonical order.
  const COLLECTION_TOKENS = ["site", "artist", "uploader", "title", "text", "id", "date", "tags"];
  const DEFAULT_COLLECTION_TEMPLATE = "{artist} - {title} - {id}";
  const TOKEN_SEPARATOR = " - ";
  const TEXT_TOKEN_LENGTH = 40;

  function templateTokensInUse(template) {
    const result = {};
    const text = String(template || "");
    for (const token of COLLECTION_TOKENS) {
      result[token] = text.indexOf("{" + token + "}") !== -1;
    }
    return result;
  }

  // True when the stored template is fully representable by the checkboxes:
  // only known placeholders plus whitespace / simple separators. Anything else
  // (literal words, custom ordering tricks) is a "custom" template and the
  // popup keeps the manual input so nothing is lost.
  function isTokenOnlyTemplate(template) {
    const known = COLLECTION_TOKENS.map((token) => "\\{" + token + "\\}").join("|");
    const stripped = String(template || "").replace(new RegExp(known, "g"), "");
    return /^[\s\-_,.()\[\]]*$/.test(stripped);
  }

  function buildTemplate(checked, separator) {
    const parts = [];
    for (const token of COLLECTION_TOKENS) {
      if (checked && checked[token]) parts.push("{" + token + "}");
    }
    return parts.join(separator || TOKEN_SEPARATOR);
  }

  function tokenValues(context) {
    const ctx = context || {};
    const title = String(ctx.title || "");
    return {
      site: String(ctx.site || ""),
      artist: String(ctx.artist || ""),
      uploader: String(ctx.uploader || ""),
      title: title,
      text: title.slice(0, TEXT_TOKEN_LENGTH),
      id: String(ctx.id || ""),
      date: String(ctx.date || ""),
      tags: Array.isArray(ctx.tags) ? ctx.tags.join(", ") : String(ctx.tags || ""),
    };
  }

  // Collapse the gaps an empty token leaves behind ("A -  - B" -> "A - B") so
  // a missing artist never produces "  - Title - 123".
  function tidySeparators(text) {
    return String(text || "")
      .replace(/[\t\r\n]+/g, " ")
      .replace(/ {2,}/g, " ")
      .replace(/(?:\s*-\s*){2,}/g, TOKEN_SEPARATOR)
      .replace(/^[ ,\-.()\s]+/, "")
      .replace(/[ ,\-.()\s]+$/, "")
      .trim();
  }

  function fillTemplate(template, context) {
    const values = tokenValues(context);
    let out = String(template || "");
    for (const token of COLLECTION_TOKENS) {
      out = out.split("{" + token + "}").join(values[token] || "");
    }
    // Unknown placeholders never reach the file system as literal braces.
    out = out.replace(/\{[A-Za-z_][\w]*\}/g, "");
    return tidySeparators(out);
  }

  // Which of the three ways of naming the collection folder won:
  //   manual  - the user typed a tag/folder name (highest priority)
  //   template- the checkbox/template string filled from the post's metadata
  //   search  - the search/tag-results query the download started from
  //   id      - last resort so the folder is never empty
  function resolveCollectionName(options) {
    const opts = options || {};
    const context = opts.context || {};
    const fallbackId = String(opts.fallbackId || context.id || "").trim();
    const fallback = fallbackId || "untagged";
    const checkedTags = Array.isArray(opts.checkedTags) ? opts.checkedTags.filter(Boolean) : [];
    const manual = String(opts.manual || "").trim();
    // An explicitly empty template means the user unchecked every token: fall
    // through to the search query / post id instead of quietly re-applying the
    // default. Only an absent template gets the default.
    const template = opts.template === undefined || opts.template === null
      ? DEFAULT_COLLECTION_TEMPLATE
      : String(opts.template);
    const templateResult = fillTemplate(template, {
      ...context,
      tags: checkedTags,
    });
    const searchContext = String(opts.searchContext || "").trim();
    const source = manual ? "manual" : (templateResult ? "template" : (searchContext ? "search" : "id"));
    const chosen = manual || templateResult || searchContext || fallbackId;
    const name = sanitizeSegment(chosen, fallback);
    if (!opts.artistFolderMode) return { name, source };

    // Artist-folder mode: <Site>/<Artist>/<post>. Falls back uploader -> id ->
    // "untagged". A leading duplicate of the artist is dropped from the post
    // part so the default template does not repeat it.
    const artist = context.artist || context.uploader ? sanitizeSegment(String(context.artist || context.uploader), "") : "";
    const head = artist;
    let tail = name;
    if (artist && tail.toLowerCase().indexOf(artist.toLowerCase()) === 0) {
      tail = tidySeparators(tail.slice(artist.length));
    }
    const segments = [head, tail].filter(Boolean);
    return { name: segments.join("/") || fallback, source };
  }

  // Keep the whole relative path inside the length limits the file systems
  // impose (Windows MAX_PATH is 260 and Chrome refuses the download outright
  // with FILE_NAME_TOO_LONG). The collection segment is the only variable one
  // worth shrinking, so it absorbs the overflow.
  const MAX_TOTAL_PATH_LENGTH = 240;

  function fitTotalLength(segments, fileName) {
    const parts = segments.slice();
    const overhead = parts.join("/").length + fileName.length + 1;
    let overflow = overhead - MAX_TOTAL_PATH_LENGTH;
    for (let index = parts.length - 1; index >= 0 && overflow > 0; index -= 1) {
      const keep = Math.max(1, parts[index].length - overflow);
      overflow -= parts[index].length - keep;
      parts[index] = parts[index].slice(0, keep).replace(/[. ]+$/g, "") || parts[index].slice(0, 1);
    }
    return parts;
  }

  // The one function the download pipeline calls. Returns the relative
  // subpath handed to chrome.downloads.download, e.g.
  //   R34V/rule34video/Artist - Title - 123/Title - 123.mp4
  function buildRelativePath(options) {
    const opts = options || {};
    const masterFolder = normalizeMasterFolder(opts.masterFolder);
    const site = siteSlugForUrl(opts.site || opts.url || "");
    const context = opts.context || {};
    const fallbackId = String(opts.fallbackId || context.id || "").trim() || "untitled";

    const collection = resolveCollectionName({
      manual: opts.manual,
      template: opts.template,
      checkedTags: opts.checkedTags,
      searchContext: opts.searchContext,
      artistFolderMode: Boolean(opts.artistFolderMode),
      context: { ...context, site },
      fallbackId,
    });

    const extension = /^[A-Za-z0-9]{1,5}$/.test(String(opts.ext || "")) ? String(opts.ext).toLowerCase() : "";
    const basename = sanitizeSegment(
      opts.basename || context.title || fallbackId,
      fallbackId,
    );
    const fileName = extension ? `${basename}.${extension}` : basename;

    const directorySegments = [masterFolder, site, collection.name]
      .filter((segment) => String(segment || "").trim() !== "")
      .join("/")
      .split("/")
      .map((segment) => prefixReservedWindowsName(sanitizeSegment(segment, fallbackId)))
      .filter(Boolean);

    const directory = fitTotalLength(directorySegments, fileName).join("/");
    if (!directory) return sanitizeSegment(fileName, "download");
    return `${directory}/${fileName}`;
  }

  // The directory part only (what the popup previews as the folder).
  function buildDirectoryPath(options) {
    const full = buildRelativePath(options);
    const index = full.lastIndexOf("/");
    return index > 0 ? full.slice(0, index) : "";
  }

  // --- search context -----------------------------------------------------
  // When the download started from a search / tag-results / playlist page, the
  // current query is offered as the folder name.
  function searchContextFromUrl(url) {
    const text = String(url || "");
    if (!/^https?:\/\//i.test(text)) return "";
    let parsed;
    try {
      parsed = new URL(text);
    } catch {
      return "";
    }
    const path = parsed.pathname.replace(/\/+$/, "");
    const searchMatch = path.match(/\/search\/([^/]+)/i);
    if (searchMatch) return decodeSearchFragment(searchMatch[1]);
    const tagMatch = path.match(/\/tags?\/([^/]+)/i);
    if (tagMatch) return decodeSearchFragment(tagMatch[1]);
    const playlistMatch = path.match(/\/playlist\/([^/]+)/i);
    if (playlistMatch) return decodeSearchFragment(playlistMatch[1]);
    for (const key of ["q", "query", "search", "tag", "tags"]) {
      const value = parsed.searchParams.get(key);
      if (value && value.trim()) return value.trim();
    }
    return "";
  }

  function decodeSearchFragment(value) {
    try {
      return decodeURIComponent(String(value || "")).trim();
    } catch {
      return String(value || "").trim();
    }
  }

  // Loose picture sets are numbered 001.jpg, 002.jpg, ... so viewers sort them
  // correctly (same convention as the sister project's raw mode).
  function padNumber(value, width) {
    const digits = Math.max(3, Number(width) || 3);
    return String(Number(value) || 0).padStart(digits, "0");
  }

  const api = {
    DEFAULT_MASTER_FOLDER,
    DEFAULT_COLLECTION_TEMPLATE,
    COLLECTION_TOKENS,
    TOKEN_SEPARATOR,
    MAX_SEGMENT_LENGTH,
    MAX_TOTAL_PATH_LENGTH,
    SITE_SLUG_BY_HOST,
    KNOWN_SITE_SLUGS,
    normalizeMasterFolder,
    siteSlugForUrl,
    cleanSegment,
    sanitizeArtifactFilename,
    sanitizeSegment,
    prefixReservedWindowsName,
    safeRelativePath,
    templateTokensInUse,
    isTokenOnlyTemplate,
    buildTemplate,
    fillTemplate,
    tidySeparators,
    resolveCollectionName,
    buildRelativePath,
    buildDirectoryPath,
    searchContextFromUrl,
    padNumber,
  };

  try {
    root.R34FolderNaming = api;
  } catch {}
  try {
    root.R34FolderNamingDefaults = { DEFAULT_MASTER_FOLDER, DEFAULT_COLLECTION_TEMPLATE };
  } catch {}
})(typeof globalThis !== "undefined" ? globalThis : this);
