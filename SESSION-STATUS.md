# SESSION-STATUS

## Four owner corrections, second pass — 2026-10-03T19:45+02:00

**Baseline:** `npm test` → 545/545. **Now:** → **547/547** (run, not quoted).
**Scope:** COMPLETE and DEPLOYED as `2828b59` / commit `663230b`.

**Finding worth keeping:** three of the four items were **my previous work being
wrong**, and the most valuable moment was the owner saying *"what I wrote about is
not fully true"* — that falsified my expansion diagnosis, which I then discarded
instead of patching. A latched manual override would have broken the FOLDING too,
and folding worked.

**MEASURED (live, build 2828b59):**
- Info band 53 → **82 px** swipeable, both bands `touch-action: none`, scrolling
  body untouched
- `Vilket program` unnumbered and explained; four real actions numbered **1–4**
- Podcast/channel empty states carry **no count**; grep on the hashed bundle → 0
- Expanded panel: both artwork writers now repaint it

**What this does NOT prove:** nothing here is device-verified. ITEM 4's fix has
not been observed on a real song change — it is code-proven only. The Info swipe
band has never been felt.

**Deploy checks:** suite green + count up PASS · diff 3 files, nothing outside
scope PASS · driven in the live browser on rendered DOM PASS · all four stated
defects confirmed fixed PASS · neighbours untouched PASS · hashed bundles grepped
PASS · propagation: first poll served the OLD bundle with new assets 404 —
confirmed as propagation (commit on remote, raw host 404), then PASS on re-poll.

**Mutations:** M10–M13, all red first time. Checksums byte-identical after each.

**Blocked:** nothing.

**Next:** owner checks build **`2828b59`** on the iPhone — the small line under
NYHETER. If it does not read 2828b59 they are testing old code.
