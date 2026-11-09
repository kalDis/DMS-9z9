# Ad Sync — API Setup Guide (Meta Ads + TikTok Ads)

This guide shows how to get the API credentials DMS needs to **auto-sync ad spend** from
Meta (Facebook / Instagram) Ads and TikTok Ads into the Ad ROI module.

You do this **once per business** (Tyshoo and Kyshoo have separate ad accounts, so you
collect one set of values for each). Give the final values to DMS → Admin → Ad Sync.

> ⏳ **Heads-up:** App creation + token generation can take a few days (business
> verification / app review). Start now; DMS can be built in parallel.

---

## Part A — Meta (Facebook / Instagram) Ads

Meta ad data comes from the **Marketing API** using a **System User token** (these can be
made non-expiring, which is what we want for an automatic sync).

### A1. Find your Ad Account ID
1. Go to **Meta Ads Manager** → top-left account selector.
2. The Ad Account ID looks like `act_1234567890` (the number after `act_`).
3. Do this for **each business** (Tyshoo ad account, Kyshoo ad account).

### A2. Create a Meta App
1. Go to **https://developers.facebook.com/apps** → **Create App**.
2. App type: **Business**.
3. After it's created, open the app → **Add Product** → add **Marketing API**.
4. From **App Settings → Basic**, note the **App ID** and **App Secret**.

### A3. Create a System User + token (in Business Settings)
1. Go to **Meta Business Suite → Business Settings** (business.facebook.com/settings).
2. **Users → System Users → Add** → create one (e.g. "DMS Sync"), role **Admin** or **Employee**.
3. **Assign assets** → assign the **Ad Account(s)** (Tyshoo, Kyshoo) with **View performance**
   (read) access — `ads_read` is enough for spend reporting.
4. Also assign the **App** you created in A2 to this system user.
5. Click **Generate New Token** → pick the app → select scope **`ads_read`**
   (add `ads_management` only if later needed) → generate.
6. **Copy the token now** (shown once). This is your **Meta Access Token**.

> 💡 System User tokens generated this way are long-lived / effectively non-expiring, so the
> daily sync keeps working. If you ever rotate it, just paste the new one into DMS.

### A4. Meta values to collect (per business)
- Ad Account ID — `act_…`
- Access Token (System User)
- App ID *(optional, for future token checks)*
- App Secret *(optional)*

---

## Part B — TikTok Ads

TikTok ad data comes from the **TikTok Marketing API** (TikTok for Business). You create a
developer app, authorize it for your advertiser account, and get an access token.

### B1. Find your Advertiser ID
1. Go to **TikTok Ads Manager** (ads.tiktok.com).
2. Account/Advertiser ID is shown in account settings / the URL (a long number).
3. Do this for **each business**.

### B2. Create a TikTok developer app
1. Go to **https://business-api.tiktok.com** → **Developers** → **My Apps** → **Create an App**.
2. Fill in app name, description, and a redirect URL (any https URL you control is fine for
   generating the token; e.g. your DMS URL).
3. Request scope: **Ad Account Management (read)** / **Reporting** (so it can read spend).
4. After approval, note the **App ID** and **App Secret (Secret)**.

### B3. Authorize + get the Access Token
1. In the app, use the **Authorization** flow (TikTok shows an authorized-URL button).
2. Log in with the account that owns the advertiser, approve → TikTok returns an
   **auth code**.
3. Exchange the auth code for a **long-lived access token** (TikTok's token page / API does
   this; the token is tied to the advertiser).
4. **Copy the Access Token** and the **Advertiser ID(s)** it covers.

> ⏳ TikTok apps usually need **review/approval** before the reporting scope works — this is
> the step most likely to take a few days.

### B4. TikTok values to collect (per business)
- Advertiser ID
- Access Token
- App ID *(optional)*
- App Secret *(optional)*

---

## Part C — Campaign naming (for automatic product mapping)

DMS maps each campaign's spend to a **product (SKU)** two ways:

1. **Manual mapping** (safe zone) — you map a campaign → product once in DMS; this always wins.
2. **Campaign name → SKU** — if a campaign isn't manually mapped, DMS reads the **SKU from the
   campaign name**.

So, to get automatic mapping, **put the product SKU at the start of the campaign name**, e.g.:

```
KY005 - Ladies Slipper - Nov Promo
TY012 | Denim Slipper | Retargeting
```

DMS picks up the SKU token (e.g. `KY005`, `TY012`). Campaigns with no recognizable SKU show up
as **Unmapped** in DMS, where you map them by hand. Nothing is lost — unmapped spend is just
held aside until you map it.

---

## ✅ Final checklist — what to hand to DMS

For **each business** (Tyshoo, Kyshoo), collect:

| Platform | Values |
|---|---|
| **Meta** | Ad Account ID (`act_…`), Access Token |
| **TikTok** | Advertiser ID, Access Token |

(App ID / Secret are optional extras.)

Paste these into **DMS → Admin → Ad Sync** per business. Then DMS will sync once a day
(time configurable), and you can press **Sync now** any time.

> 🔒 These tokens are powerful — they can read your ad accounts. Share them only inside DMS,
> don't post them in public chats, and rotate them if they ever leak.
