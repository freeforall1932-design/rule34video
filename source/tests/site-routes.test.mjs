// Fixture tests for the URL router + listing parsers (extension/site-routes.js).
//
// The whole UI is "fire only on URLs we recognise", so the router is the
// contract every surface (service worker, side panel, content scripts) relies
// on. The rule34video.com listing parser is exercised against the saved page
// dump in source/page-source/rule34video-listing.html.
//
// Run: node --test source/tests/site-routes.test.mjs

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadClassicScript } from "./helpers/loadClassicScript.mjs";

let R;
const listingHtml = readFileSync(join(process.cwd(), "source/page-source/rule34video-listing.html"), "utf8");

before(async () => {
  R = await loadClassicScript("site-routes.js", "R34Routes");
});

describe("rule34video.com routes", () => {
  it("recognises single video pages", () => {
    const route = R.match("https://rule34video.com/video/4573905/3-girls-and-1-ryouji-sub-espanol/");
    assert.equal(route.site, "video");
    assert.equal(route.kind, "video");
    assert.equal(route.id, "4573905");
    assert.equal(R.isSinglePost(route), true);
    assert.equal(R.isListing(route), false);
    assert.equal(R.match("https://rule34video.com/popup-video/4573905/?popup_id=1").id, "4573905");
    // The site 404s on slug-less /video/{id}/ URLs: keep the slug, pad with the id.
    assert.equal(route.canonicalUrl, "https://rule34video.com/video/4573905/3-girls-and-1-ryouji-sub-espanol/");
    assert.equal(R.match("https://rule34video.com/video/4573905/").canonicalUrl, "https://rule34video.com/video/4573905/4573905/");
    assert.equal(R.match("https://rule34video.com/popup-video/4573905/?popup_id=1").canonicalUrl, "https://rule34video.com/video/4573905/4573905/");
  });

  it("recognises the homepage as the latest-updates listing", () => {
    const route = R.match("https://rule34video.com/");
    assert.equal(route.kind, "home");
    assert.equal(route.page, 1);
    assert.equal(route.listingUrl, "https://rule34video.com/latest-updates/");
    assert.equal(R.isListing(route), true);
    assert.equal(R.match("https://rule34video.com/latest-updates/7/").page, 7);
  });

  it("recognises search pages with their page number and query", () => {
    const route = R.match("https://rule34video.com/search/touhou%20art/3/");
    assert.equal(route.kind, "search");
    assert.equal(route.query, "touhou art");
    assert.equal(route.page, 3);
    assert.equal(route.listingUrl, "https://rule34video.com/search/touhou%20art/");
    assert.equal(R.match("https://rule34video.com/search/?q=tifa").query, "tifa");
  });

  it("recognises tags, categories, artists, members and playlists", () => {
    assert.equal(R.match("https://rule34video.com/tags/26528/").kind, "tag");
    assert.equal(R.match("https://rule34video.com/categories/bioshock/").kind, "category");
    assert.equal(R.match("https://rule34video.com/models/jackerman/2/").page, 2);
    assert.equal(R.match("https://rule34video.com/members/48646/").kind, "member");
    const playlist = R.match("https://rule34video.com/playlists/3072/bioshock3/");
    assert.equal(playlist.kind, "playlist");
    assert.equal(playlist.id, "3072");
    assert.equal(playlist.listingUrl, "https://rule34video.com/playlists/3072/bioshock3/");
    assert.equal(R.match("https://rule34video.com/playlists/").kind, "playlists");
  });

  it("ignores pages the extension has no business on", () => {
    assert.equal(R.match("https://rule34video.com/terms/"), null);
    assert.equal(R.match("https://rule34video.com/login/"), null);
    assert.equal(R.match("https://example.com/video/1/"), null);
    assert.equal(R.match("not a url"), null);
  });

  it("builds the KVS get_block ajax URL per listing type", () => {
    const search = R.match("https://rule34video.com/search/touhou/");
    const page2 = new URL(R.videoListingPageUrl(search, 2));
    assert.equal(page2.searchParams.get("mode"), "async");
    assert.equal(page2.searchParams.get("block_id"), "custom_list_videos_videos_list_search");
    assert.equal(page2.searchParams.get("q"), "touhou");
    assert.equal(page2.searchParams.get("from_videos"), "2");
    assert.equal(R.videoListingPageUrl(search, 1), "https://rule34video.com/search/touhou/");

    const tag = R.match("https://rule34video.com/tags/26528/");
    const tagPage = new URL(R.videoListingPageUrl(tag, 3));
    assert.equal(tagPage.searchParams.get("block_id"), "custom_list_videos_common_videos");
    assert.equal(tagPage.searchParams.get("from"), "3");

    const playlist = R.match("https://rule34video.com/playlists/3072/bioshock3/");
    const playlistPage = new URL(R.videoListingPageUrl(playlist, 2));
    assert.equal(playlistPage.searchParams.get("block_id"), "playlist_view_playlist_view");
    assert.equal(playlistPage.searchParams.get("from"), "2");
    assert.equal(R.videoListingPageHref(search, 4), "https://rule34video.com/search/touhou/4/");
  });
});

describe("rule34.world routes", () => {
  it("recognises posts, the homepage, tags, feeds and playlists", () => {
    const post = R.match("https://rule34.world/post/3571567");
    assert.equal(post.kind, "post");
    assert.equal(post.id, "3571567");
    assert.equal(R.isSinglePost(post), true);

    const home = R.match("https://rule34.world/");
    assert.equal(home.kind, "home");
    assert.deepEqual(home.tags, []);
    assert.equal(R.isListing(home), true);

    const tag = R.match("https://rule34.world/touhou?page=2");
    assert.equal(tag.kind, "tag");
    assert.deepEqual(tag.tags, ["touhou"]);
    assert.equal(tag.page, 2);

    const multi = R.match("https://rule34.world/genshin_impact%7Cvideo?type=video&sort=top");
    assert.deepEqual(multi.tags, ["genshin impact", "video"]);
    assert.equal(multi.mediaType, "video");
    assert.equal(multi.sort, "top");

    assert.equal(R.match("https://rule34.world/hot").kind, "feed");
    assert.equal(R.match("https://rule34.world/playlists/view/123").kind, "playlist");
    assert.equal(R.match("https://rule34.world/playlists").kind, "playlists");
  });

  it("does not treat reserved paths as tags", () => {
    assert.equal(R.match("https://rule34.world/auth/login"), null);
    assert.equal(R.match("https://rule34.world/comments"), null);
    assert.equal(R.match("https://rule34.world/upgrade-to-premium"), null);
  });

  it("maps a listing page to the search API body", () => {
    const route = R.match("https://rule34.world/touhou?page=3&type=image");
    const body = R.worldSearchBody(route, route.page);
    assert.deepEqual(body.includeTags, ["touhou"]);
    assert.equal(body.Skip, 60);
    assert.equal(body.take, 30);
    assert.equal(body.type, 0);
    assert.equal(body.OrderBy, 0);
    assert.equal(R.worldThumbnail(1391429), "https://rule34storage.b-cdn.net/posts/1391/1391429/1391429.pic256.jpg");
    const href = new URL(R.worldListingPageHref(route, 5));
    assert.equal(href.pathname, "/touhou");
    assert.equal(href.searchParams.get("page"), "5");
    assert.equal(href.searchParams.get("type"), "image", "the user's media filter survives the crawl");
  });
});

describe("page ranges", () => {
  it("parses the nh-dw grammar", () => {
    assert.deepEqual(R.parsePageRange("2,4,6-10", 99), [2, 4, 6, 7, 8, 9, 10]);
    assert.deepEqual(R.parsePageRange("1-3", 99), [1, 2, 3]);
    assert.deepEqual(R.parsePageRange(" 5 ", 99), [5]);
    assert.deepEqual(R.parsePageRange("all", 4), [1, 2, 3, 4]);
    assert.deepEqual(R.parsePageRange("", 2), [1, 2]);
    assert.deepEqual(R.parsePageRange("98-", 99), [98, 99]);
  });

  it("clamps to the known last page and rejects nonsense", () => {
    assert.deepEqual(R.parsePageRange("1-99", 3), [1, 2, 3]);
    assert.throws(() => R.parsePageRange("abc", 10), /Cannot read/);
    assert.throws(() => R.parsePageRange("9-3", 10), /before the start/);
    assert.throws(() => R.parsePageRange("all", 0), /unknown/);
    assert.throws(() => R.parsePageRange("200", 10), /No pages/);
  });

  it("never explodes on an absurd range", () => {
    assert.equal(R.parsePageRange("1-999999", 0).length, R.PAGE_RANGE_HARD_CAP);
  });
});

describe("rule34video.com listing parser", () => {
  it("extracts every card once, with title, thumbnail and duration", () => {
    const items = R.parseVideoListing(listingHtml, "https://rule34video.com/");
    assert.equal(items.length, 35);
    const first = items.find((item) => item.id === "4573905");
    assert.ok(first, "the first card is present");
    assert.equal(first.title, "3 Girls and 1 Ryouji - Sub Español");
    assert.equal(first.url, "https://rule34video.com/video/4573905/3-girls-and-1-ryouji-sub-espanol/");
    assert.match(first.thumbnail, /videos_screenshots\/4573000\/4573905/);
    assert.equal(first.duration, "34:52");
    assert.equal(first.type, "video");
    assert.equal(new Set(items.map((item) => item.id)).size, items.length, "no duplicates");
  });

  it("reads the total page count from the pagination block", () => {
    assert.equal(R.parseVideoListingPageCount(listingHtml), 9136);
    assert.equal(R.parseVideoListingPageCount("<html><body>no pagination</body></html>"), 0);
  });
});

describe("rule34video.com listing parser — main block only", () => {
  it("ignores sidebar / 'top videos today' cards when the page has a main items block", () => {
    const card = (id) => `<div class="item thumb" data-video-card-id="${id}"><a class="th js-open-popup" href="https://rule34video.com/video/${id}/x/" title="V ${id}"><div class="img wrap_image"><img class="thumb" data-original="https://rule34video.com/${id}.jpg"></div></a></div>`;
    const html = `<html><body>
      <div class="thumbs" id="custom_list_videos_videos_list_search_items">${card(1)}${card(2)}</div>
      <div class="pagination" id="custom_list_videos_videos_list_search_pagination"></div>
      <div class="sidebar"><h2>Top Videos Today</h2>${card(900)}${card(901)}</div>
    </body></html>`;
    assert.deepEqual(R.parseVideoListing(html).map((item) => item.id), ["1", "2"]);
    // A 404 / sidebar-only page yields the cards it has (the crawler then
    // detects the repetition and stops), never a crash.
    const noMain = `<html><body><h2>Top Videos Today</h2>${card(900)}</body></html>`;
    assert.deepEqual(R.parseVideoListing(noMain).map((item) => item.id), ["900"]);
  });
});
