# WDC Field Collection App

A progressive web app (PWA) for field specimen collection at the **Wyoming Dinosaur Center**. Built for iPad and iPhone, works offline in the field, and syncs to a cloud database when connectivity is available.

![WDC Field App](WDC_fieldApp.png)

---

## Overview

Field teams use this app to log paleontological specimens at the moment of discovery. Every record follows the [Darwin Core](https://dwc.tdwg.org/) standard with the [PaleoContext extension](https://tdwg.github.io/paleo/), making WDC data compatible with iDigBio, GBIF, and the Paleobiology Database without transformation.

---

## Features

- **Offline-first** — full read/write with no connectivity; syncs automatically when back online with item count feedback
- **Offline sign-in** — after one online sign-in on a device, the user can sign in offline with their password (verified against a local hash); always re-verified with Supabase on reconnect
- **Local cache** — all sites and the active site's specimens are cached on-device so they remain browsable offline
- **Darwin Core aligned** — all fields map directly to DwC / PaleoContext terms
- **Audit log** — every change to sites and specimens is recorded with full before/after snapshots and user attribution
- **GPS + compass capture** — tap to fill coordinates and specimen orientation from device sensors
- **Photo management** — capture or pick photos, queued offline and synced when connectivity returns
- **Role-based access** — six roles enforced at the database level via Row Level Security
- **Radial map points** — up to 4 reference point measurements (A–D) per specimen
- **Auto catalog numbers** — format `{SITE}-{YYYY}-{###}`, scans existing records to prevent duplicates; offline records show "Pending" and are assigned a number at sync time
- **Always-latest when online** — network-first service worker; an online device always loads the newest version, with no need to clear cache or browser data
- **Paginated specimen list** — 8 most recent specimens shown, with Load More for older records
- **Dark mode** — follows device system preference automatically
- **Soft-delete sites** — archive sites without losing data; archived sites hidden from field view

---

## Tech Stack

| Layer | Service |
|-------|---------|
| Database & Auth | [Supabase](https://supabase.com) (PostgreSQL + Auth + Storage) |
| Hosting | [GitHub Pages](https://pages.github.com) |
| Standards | Darwin Core · PaleoContext Extension |
| Runtime | Vanilla JS PWA — no framework, no build step |

---

## Project Structure

```
wdc-field/
├── index.html              # Complete single-file PWA
├── sw.js                   # Service worker (stale-while-revalidate caching)
├── manifest.json           # PWA manifest for home screen install
├── WDC_fieldApp.png        # Splash screen / app icon
├── supabase-schema.sql     # Full database schema — run once in Supabase SQL Editor
├── SCHEMA.md               # Complete schema reference and Darwin Core crosswalk
└── README.md               # This file
```

---

## Database Schema

The schema lives in `supabase-schema.sql`. Six tables:

| Table | DwC Class | Description |
|-------|-----------|-------------|
| `profiles` | — | Users, roles, contact info |
| `locations` | Location | Dig sites (soft-deletable via `is_archived`) |
| `occurrences` | Occurrence + Event + Taxon + GeologicContext | Specimen records |
| `custody_events` | — | Immutable chain-of-custody log |
| `media` | associatedMedia | Photos and files |
| `audit_log` | — | Full before/after snapshots of every change to locations and occurrences |

See `SCHEMA.md` for the full field-by-field reference including Darwin Core term mappings.

---

## Setup

### 1. Database

1. Create a [Supabase](https://supabase.com) project
2. Open **SQL Editor** → paste the contents of `supabase-schema.sql` → **Run**
3. Go to **Authentication → URL Configuration** and set:
   - **Site URL**: `https://{your-github-org}.github.io`
   - **Redirect URLs**: `https://{your-github-org}.github.io/**`
4. Create your account via the admin app invite flow, then promote yourself:
   ```sql
   update profiles set role = 'admin'::user_role
   where email = 'your@email.com';
   ```

### 2. App configuration

Update the Supabase credentials in `index.html` (top of the `<script>` block):

```javascript
const SUPABASE_URL  = 'https://your-project.supabase.co';
const SUPABASE_ANON = 'your-anon-public-key';
```

### 3. Deploy

Push to GitHub. Enable **GitHub Pages** from the repo settings (source: main branch, root directory). The app is live at `https://{org}.github.io/{repo}/`.

---

## User Roles

| Role | Description |
|------|-------------|
| `intern` | Field data entry; create and edit own records |
| `staff` | Field data entry; create and edit own records |
| `registrar` | Collections management; read audit log |
| `management` | Edit any record; archive sites; read audit log |
| `researcher` | Read access |
| `admin` | Full access; manage users via admin app |

All permissions are enforced by Supabase Row Level Security — not just the UI.

---

## New User Onboarding

Users are invited from the admin app. The invite generates a magic link that directs the new user to `onboard.html` (hosted in the admin repo) to set their name, phone, mailing address, and password before being routed to the appropriate app.

---

## Offline Behaviour

The app is designed to be used in the field with no connectivity and to sync cleanly when a connection returns.

### Updates & caching strategy

The service worker (`sw.js`) is **network-first for the app shell**:

- **Online** → the latest `index.html` is always fetched from the network and the cache is refreshed. The document request uses `cache: 'no-store'`, so a stale GitHub Pages / Safari HTTP-cached page can never shadow a new deploy. An online device always runs the newest version.
- **Offline** → the last-used cached copy is served, so the app still opens and works.

This replaces the earlier *stale-while-revalidate* shell strategy, which served the old cached copy first and was the cause of online devices getting stuck on a previous version.

**Automatic updates (no cache-clearing required).** A new service worker calls `skipWaiting()` + `clients.claim()`, the page promotes a freshly-installed worker and reloads itself once when the new version takes over, and `activate` purges all old caches. The app also re-checks for a new version whenever it regains focus or reconnects — important for home-screen PWAs that are rarely fully closed. On a device currently stuck on an old cache, the next online open fetches the new worker, installs it, and reloads into the latest version automatically.

CDN libraries (Supabase JS) are cache-first since they are version-pinned and immutable. Supabase API calls go straight to the network — the app handles its own offline behaviour (local cache + write queue), so the service worker never fabricates fake responses.

### Data: local cache + write queue

- **Reads** — all sites and the active site's specimens are cached in `localStorage` (specimens accumulate as sites are opened online). Offline, the Sites and Specimens views, and the specimen edit form, read straight from this cache with no network attempt.
- **Writes** — every change made offline is queued in `localStorage`; photos are queued in IndexedDB. On reconnect the queue is flushed in dependency order (sites → specimens → custody events).
- **Catalog numbers** — generated against the live database, so they are **deferred while offline**. Offline records display "Pending — assigned on sync" and receive their real sequential `{SITE}-{YYYY}-{###}` number when synced, with a per-site counter that prevents collisions across a batch of offline finds. Queued photos are repathed to the real catalog number before upload.

### Authentication offline

On the first successful **online** sign-in, the device stores a PBKDF2 hash of the password plus the user's profile (id, name, role) in `localStorage`. When offline, the login screen verifies the entered password against that local hash and grants access — no network required. The session is always re-verified with Supabase on reconnect; if the live session has lapsed, a non-destructive prompt asks the user to sign in to sync (queued data stays safe the whole time). Signing out explicitly clears the stored device credentials.

## Platform Support

iPhone-first (iOS Safari and standalone home-screen PWA), with Android/Chromium supported on a best-effort basis. The update and offline logic uses standard service-worker behaviour that works across both; the service worker uses relative paths so the same file is reusable by the forthcoming Lab app. One iOS caveat: a PWA suspended in the background for a long time may be slow to run its update check, but the focus/reconnect re-check plus network-first means it self-corrects as soon as it is foregrounded online.

---

## Darwin Core Alignment

Field app labels map to standard DwC terms:

| App Label | Database Column | Darwin Core Term |
|-----------|----------------|-----------------|
| Specimen # | `"catalogNumber"` | catalogNumber |
| Date Discovered | `"eventDate"` | eventDate |
| Collector | `"recordedBy"` | recordedBy |
| Taxon | `scientific_name` | scientificName |
| Formation | `formation` | formation |
| Associations | `associated_occurrences` | associatedOccurrences |
| GPS | `decimal_latitude` / `decimal_longitude` | decimalLatitude / decimalLongitude |

Full crosswalk in `SCHEMA.md`.

---

## Roadmap

- [x] Phase 1 — Field Collection App (this app)
- [ ] Phase 2 — Preparation Lab App
- [ ] Phase 3 — Collections Catalog App
- [ ] Phase 4 — Admin & Reporting
- [ ] Phase 5 — Public Research Portal

---

## Contributing

This project is developed for the Wyoming Dinosaur Center. All specimen data is proprietary to WDC.

---

*Wyoming Dinosaur Center · Thermopolis, Wyoming*
