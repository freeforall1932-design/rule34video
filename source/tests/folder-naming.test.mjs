// Fixture tests for the output-organization engine (extension/folder-naming.js):
// path sanitizing, the hostname -> site slug map, the master folder, the
// collection-name template engine and the full relative download path.
//
// Run: node --test source/tests/folder-naming.test.mjs

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { loadClassicScript } from "./helpers/loadClassicScript.mjs";

let FN;

before(async () => {
  FN = await loadClassicScript("folder-naming.js", "R34FolderNaming");
});

describe("master folder", () => {
  it("defaults to R34V when the setting was never stored", () => {
    assert.equal(FN.DEFAULT_MASTER_FOLDER, "R34V");
    assert.equal(FN.normalizeMasterFolder(undefined), "R34V");
    assert.equal(FN.normalizeMasterFolder(null), "R34V");
  });

  it("keeps a custom name and lets slashes nest deeper", () => {
    assert.equal(FN.normalizeMasterFolder("  Hentai  "), "Hentai");
    assert.equal(
      FN.buildRelativePath({ masterFolder: "Porn/Videos", site: "https://rule34video.com/video/1", context: { id: "1", title: "T" }, ext: "mp4" }),
      // default template "{artist} - {title} - {id}" with no artist
      "Porn/Videos/rule34video/T - 1/T.mp4",
    );
  });

  it("treats the empty string as OFF: the flat pre-feature layout", () => {
    const withMaster = FN.buildRelativePath({
      masterFolder: "R34V",
      site: "https://rule34video.com/video/4573905",
      context: { id: "4573905", title: "Some title", artist: "AnArtist" },
      ext: "mp4",
    });
    const withoutMaster = FN.buildRelativePath({
      masterFolder: "",
      site: "https://rule34video.com/video/4573905",
      context: { id: "4573905", title: "Some title", artist: "AnArtist" },
      ext: "mp4",
    });
    assert.equal(withMaster, "R34V/rule34video/AnArtist - Some title - 4573905/Some title.mp4");
    // Same path minus the master level, no leading slash, no empty segment.
    assert.equal(withoutMaster, withMaster.slice("R34V/".length));
    assert.ok(!withoutMaster.startsWith("/"));
    assert.ok(!withoutMaster.includes("//"));
  });

  it("treats whitespace-only as OFF too", () => {
    assert.equal(FN.normalizeMasterFolder("   "), "");
  });
});

describe("site slug map (automatic source separation)", () => {
  it("maps both supported sites without any user input", () => {
    assert.equal(FN.siteSlugForUrl("https://rule34video.com/video/4573905"), "rule34video");
    assert.equal(FN.siteSlugForUrl("https://www.rule34video.com/video/4573905"), "rule34video");
    assert.equal(FN.siteSlugForUrl("https://rule34.world/post/3571567"), "rule34world");
    assert.equal(FN.siteSlugForUrl("https://www.rule34.world/post/3571567"), "rule34world");
  });

  it("never mixes the two sites for the same post data", () => {
    const context = { id: "123", title: "Same title", artist: "SameArtist" };
    const a = FN.buildRelativePath({ masterFolder: "R34V", site: "https://rule34video.com/video/123", context, ext: "mp4" });
    const b = FN.buildRelativePath({ masterFolder: "R34V", site: "https://rule34.world/post/123", context, ext: "mp4" });
    assert.match(a, /^R34V\/rule34video\//);
    assert.match(b, /^R34V\/rule34world\//);
    assert.notEqual(a, b);
  });

  it("gives an unknown host its own folder instead of merging it", () => {
    assert.equal(FN.siteSlugForUrl("https://example.com/post/1"), "example-com");
    assert.equal(FN.siteSlugForUrl(""), "unknown-site");
    assert.equal(FN.siteSlugForUrl("not a url"), "unknown-site");
  });
});

describe("path sanitizing", () => {
  it("strips control characters and reserved punctuation per segment", () => {
    assert.equal(FN.sanitizeSegment('Bad<>:"|?*Name\x00'), "BadName");
    // A separator inside a single segment becomes a dash, never a new level.
    assert.equal(FN.sanitizeSegment("art/touhou"), "art-touhou");
  });

  it("drops leading dots (so .. can never escape) and trailing dots/spaces", () => {
    assert.equal(FN.safeRelativePath("R34V/../../etc/passwd", "post"), "R34V/etc/passwd");
    assert.equal(FN.sanitizeSegment("...hidden"), "hidden");
    assert.equal(FN.sanitizeSegment("trailing. "), "trailing");
  });

  it("caps a segment at 120 characters", () => {
    const long = "a".repeat(400);
    assert.equal(FN.sanitizeSegment(long).length, FN.MAX_SEGMENT_LENGTH);
  });

  it("prefixes Windows reserved device names", () => {
    assert.equal(FN.sanitizeSegment("CON", "x"), "_CON");
    assert.equal(FN.sanitizeSegment("nul", "x"), "_nul");
    assert.equal(FN.sanitizeSegment("COM1", "x"), "_COM1");
    assert.equal(FN.prefixReservedWindowsName("video.mp4"), "video.mp4");
    assert.equal(FN.sanitizeArtifactFilename("R34V/site/CON/file.mp4", "post"), "R34V/site/CON/file.mp4");
    assert.equal(FN.safeRelativePath("R34V/site/CON/file.mp4", "post"), "R34V/site/_CON/file.mp4");
  });

  it("falls back to the post id when a name sanitizes to nothing", () => {
    assert.equal(FN.sanitizeSegment("???***", "4573905"), "4573905");
    assert.equal(FN.sanitizeSegment("   ", "4573905"), "4573905");
    assert.equal(
      FN.buildRelativePath({ masterFolder: "R34V", site: "https://rule34video.com/video/4573905", context: { id: "4573905", title: "***" }, ext: "mp4" }),
      "R34V/rule34video/4573905/4573905.mp4",
    );
  });

  it("collapses separators AFTER illegal characters are stripped (not before)", () => {
    // The transferable lesson from the sister project: a token whose only
    // content gets stripped (a title of "???" inside {artist} - {title} - {id})
    // must not leave a double empty " - " gap. Separators are re-collapsed after
    // sanitizing, and never before the reserved-name prefix so "_CON" survives.
    assert.equal(FN.sanitizeSegment("nasa - ??? - 111", "x"), "nasa - 111");
    assert.equal(FN.sanitizeSegment("a - *** - 2", "x"), "a - 2");
    assert.equal(
      FN.buildRelativePath({ masterFolder: "R34V", site: "https://rule34video.com/video/4573905", context: { id: "4573905", title: "nasa - ??? - 111" }, ext: "mp4" }),
      "R34V/rule34video/nasa - 111 - 4573905/nasa - 111.mp4",
    );
    // Collapsing before the reserved-name prefix would strip "_CON" — it must survive.
    assert.equal(FN.sanitizeSegment("CON", "x"), "_CON");
    assert.equal(FN.sanitizeSegment("  CON  ", "x"), "_CON");
  });

  it("never returns an absolute path or an empty result", () => {
    const path = FN.buildRelativePath({ masterFolder: "///", site: "", context: { id: "" }, ext: "mp4" });
    assert.ok(path.length > 0);
    assert.ok(!path.startsWith("/"));
    assert.ok(!path.includes(".."));
  });

  it("keeps the whole path inside the file-system length limit", () => {
    const path = FN.buildRelativePath({
      masterFolder: "M".repeat(200),
      site: "https://rule34video.com/video/1",
      context: { id: "1", title: "T".repeat(200), artist: "A".repeat(200) },
      ext: "mp4",
    });
    assert.ok(path.length <= FN.MAX_TOTAL_PATH_LENGTH + 40, `path was ${path.length} chars`);
  });
});

describe("collection template engine", () => {
  const context = {
    site: "rule34video",
    artist: "AnArtist",
    uploader: "AnUploader",
    title: "A very long title that goes on and on forever",
    id: "4573905",
    date: "2026-09-01",
  };

  it("fills every documented token", () => {
    const filled = FN.fillTemplate("{site} {artist} {uploader} {title} {text} {id} {date} {tags}", {
      ...context,
      tags: ["tag a", "tag b"],
    });
    assert.equal(
      filled,
      [
        "rule34video",
        "AnArtist",
        "AnUploader",
        context.title,
        context.title.slice(0, 40),
        "4573905",
        "2026-09-01",
        "tag a, tag b",
      ].join(" "),
    );
    assert.equal(context.title.slice(0, 40).length, 40);
  });

  it("collapses the gap an empty token leaves behind", () => {
    assert.equal(FN.fillTemplate("{artist} - {title} - {id}", { ...context, artist: "" }), "A very long title that goes on and on forever - 4573905");
    assert.equal(FN.fillTemplate("{artist} - {title} - {id}", { ...context, title: "" }), "AnArtist - 4573905");
    assert.equal(FN.fillTemplate("{artist} - {title} - {id}", { artist: "", title: "", id: "7" }), "7");
  });

  it("rebuilds a template from checked tokens in canonical order", () => {
    assert.equal(FN.buildTemplate({ id: true, artist: true }), "{artist} - {id}");
    assert.equal(FN.buildTemplate({}), "");
    assert.equal(FN.buildTemplate({ tags: true, site: true }, "_"), "{site}_{tags}");
    assert.deepEqual(FN.COLLECTION_TOKENS, ["site", "artist", "uploader", "title", "text", "id", "date", "tags"]);
  });

  it("detects which tokens a stored template uses", () => {
    assert.deepEqual(FN.templateTokensInUse("{artist} - {id}"), {
      site: false, artist: true, uploader: false, title: false, text: false, id: true, date: false, tags: false,
    });
  });

  it("recognises a pure-checkbox template and keeps custom ones editable", () => {
    assert.equal(FN.isTokenOnlyTemplate("{artist} - {title} - {id}"), true);
    assert.equal(FN.isTokenOnlyTemplate("  "), true);
    assert.equal(FN.isTokenOnlyTemplate("[{artist}] {id}"), true);
    assert.equal(FN.isTokenOnlyTemplate("My prefix {id}"), false);
  });

  it("never lets an unknown placeholder reach the file system", () => {
    assert.equal(FN.fillTemplate("{pretty} - {id}", { id: "9" }), "9");
  });

  it("collapses a leading artist duplicated by the template", () => {
    // rule34.world reports the title as "<Artist> - <post>", so the default
    // template "{artist} - {title} - {id}" would fill to a repeated artist.
    assert.equal(
      FN.collapseRepeatedLeadingArtist("WorldArtist - WorldArtist - post 3571567 - 3571567", "WorldArtist"),
      "WorldArtist - post 3571567 - 3571567",
    );
    // A genuinely single leading artist is left untouched.
    assert.equal(FN.collapseRepeatedLeadingArtist("AnArtist - A Sample Video - 4573905", "AnArtist"), "AnArtist - A Sample Video - 4573905");
    // Missing artist / empty input returns the input as-is.
    assert.equal(FN.collapseRepeatedLeadingArtist("WorldArtist - post 3571567 - 3571567", ""), "WorldArtist - post 3571567 - 3571567");
    // An artist that is only a PREFIX of a longer title word is never mangled.
    assert.equal(FN.collapseRepeatedLeadingArtist("Sun - Sunshine - a nice day - 7", "Sun"), "Sun - Sunshine - a nice day - 7");
    // A repeated artist followed by a separator IS collapsed (the real case).
    assert.equal(FN.collapseRepeatedLeadingArtist("Sun - Sun - post 7 - 7", "Sun"), "Sun - post 7 - 7");
  });

  it("de-duplicates the artist in the collection folder for rule34.world titles", () => {
    const path = FN.buildRelativePath({
      masterFolder: "R34V",
      site: "https://rule34.world/post/3571567",
      template: "{artist} - {title} - {id}",
      context: { artist: "WorldArtist", title: "WorldArtist - post 3571567", id: "3571567" },
      basename: "WorldArtist - post 3571567",
      ext: "mp4",
    });
    assert.equal(path, "R34V/rule34world/WorldArtist - post 3571567 - 3571567/WorldArtist - post 3571567.mp4");
  });

  it("never rewrites a user-typed manual folder name", () => {
    const path = FN.buildRelativePath({
      masterFolder: "R34V",
      site: "https://rule34.world/post/3571567",
      template: "{artist} - {title} - {id}",
      manual: "WorldArtist - WorldArtist - post",
      context: { artist: "WorldArtist", title: "WorldArtist - post 3571567", id: "3571567" },
      ext: "mp4",
    });
    assert.equal(path, "R34V/rule34world/WorldArtist - WorldArtist - post/WorldArtist - post 3571567.mp4");
  });
});

describe("collection folder priority", () => {
  const context = { artist: "AnArtist", title: "Some title", id: "4573905" };
  const base = { template: "{artist} - {title} - {id}", context };

  it("manual wins over everything else", () => {
    assert.equal(FN.resolveCollectionName({ ...base, manual: "My Tag", checkedTags: ["a"], searchContext: "q" }).name, "My Tag");
  });

  it("emptying the manual field falls back to the checked-tag template", () => {
    const result = FN.resolveCollectionName({ ...base, manual: "   ", template: "{tags}", checkedTags: ["touhou", "artist a"] });
    assert.equal(result.name, "touhou, artist a");
    assert.equal(result.source, "template");
  });

  it("falls back to the search query, then to the post id, then to untagged", () => {
    assert.equal(FN.resolveCollectionName({ ...base, template: "", searchContext: "touhou art" }).name, "touhou art");
    assert.equal(FN.resolveCollectionName({ ...base, template: "" }).name, "4573905");
    assert.equal(FN.resolveCollectionName({ template: "", context: {} }).name, "untagged");
  });

  it("artist-folder mode nests under the artist and drops the duplicate prefix", () => {
    const result = FN.resolveCollectionName({ ...base, artistFolderMode: true });
    assert.equal(result.name, "AnArtist/Some title - 4573905");
  });

  it("artist-folder mode falls back uploader -> id -> untagged", () => {
    assert.equal(
      FN.resolveCollectionName({ ...base, artistFolderMode: true, context: { uploader: "Uploader", id: "5" } }).name,
      "Uploader/5",
    );
    // No artist anywhere: the artist level is skipped instead of duplicated.
    assert.equal(FN.resolveCollectionName({ template: "", artistFolderMode: true, context: { id: "42" } }).name, "42");
    assert.equal(FN.resolveCollectionName({ template: "", artistFolderMode: true, context: {} }).name, "untagged");
  });
});

describe("search context detection", () => {
  it("reads rule34video search, tag and playlist pages", () => {
    assert.equal(FN.searchContextFromUrl("https://rule34video.com/search/touhou/"), "touhou");
    assert.equal(FN.searchContextFromUrl("https://rule34video.com/search/shikamaru%20nara/"), "shikamaru nara");
    assert.equal(FN.searchContextFromUrl("https://rule34video.com/tags/26528/"), "26528");
    assert.equal(FN.searchContextFromUrl("https://rule34.world/playlist/123"), "123");
    assert.equal(FN.searchContextFromUrl("https://rule34video.com/?q=animated"), "animated");
  });

  it("returns nothing for a plain post page", () => {
    assert.equal(FN.searchContextFromUrl("https://rule34video.com/video/4573905/"), "");
    assert.equal(FN.searchContextFromUrl("https://rule34.world/post/3571567"), "");
    assert.equal(FN.searchContextFromUrl("nonsense"), "");
  });
});

describe("full download path", () => {
  it("builds Downloads/<Root>/<Site>/<Collection>/<file> for a video", () => {
    const path = FN.buildRelativePath({
      masterFolder: "R34V",
      site: "https://rule34video.com/video/4573905",
      template: "{artist} - {title} - {id}",
      context: { artist: "AnArtist", title: "Some title", id: "4573905" },
      basename: "Some title - 4573905",
      ext: "mp4",
    });
    assert.equal(path, "R34V/rule34video/AnArtist - Some title - 4573905/Some title - 4573905.mp4");
  });

  it("keeps the source container extension", () => {
    for (const ext of ["mp4", "webm", "mov", "jpg", "png"]) {
      const path = FN.buildRelativePath({
        masterFolder: "R34V",
        site: "https://rule34.world/post/100",
        context: { id: "100", title: "Pic" },
        ext,
      });
      assert.ok(path.endsWith("." + ext), path);
    }
  });

  it("exposes the folder alone for the popup preview", () => {
    const options = {
      masterFolder: "R34V",
      site: "https://rule34.world/post/100",
      context: { id: "100", title: "Pic" },
      ext: "jpg",
    };
    assert.equal(FN.buildDirectoryPath(options), "R34V/rule34world/Pic - 100");
    assert.equal(FN.buildRelativePath(options), "R34V/rule34world/Pic - 100/Pic.jpg");
  });

  it("numbers loose picture-set entries with at least three digits", () => {
    assert.equal(FN.padNumber(1), "001");
    assert.equal(FN.padNumber(12), "012");
    assert.equal(FN.padNumber(321), "321");
    assert.equal(FN.padNumber(4, 4), "0004");
  });
});
