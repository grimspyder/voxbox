# Traffic Alerts — speed monitoring and verbal warnings

Research and implementation plan. Status: **P1 in progress** — alert decision layer
(`lib/traffic/alertPolicy.ts`), jurisdiction rules (`jurisdictions.ts`) and state tracker
(`jurisdictionTracker.ts`) are implemented and covered by 25 behavioural tests. TomTom key is
live and returning limits + `countrySubdivision`. Native location service, limit provider and
speech are still to come.

**Jurisdiction detection is free:** TomTom's Snap to Roads returns `address.countrySubdivision`
(e.g. `"NC"`) in the *same* response as the speed limit, so no extra geocoding call or cost is
needed to know which state's law applies. A new state must be seen twice in a row before the app
adopts it, so a border flicker cannot swap laws mid-drive.

Author: Felix. Target: Voxbox Android (`com.grimspyder.voxbox`), targetSdk 36.

## 1. What the feature actually is

Three separate problems that are easy to conflate:

1. **Know the vehicle's speed.** Cheap and reliable (GPS). Solved.
2. **Know the posted limit for the road you are on.** The hard part. Requires licensed
   map data and a lookup strategy that does not cost a fortune per drive.
3. **Say the right thing at the right moment.** A UX/state-machine problem. Naive
   implementations nag constantly and get muted on day two.

Plus a fourth, legal one: **knowing which speed triggers a criminal charge.** That is
jurisdiction-specific, changes over time, and cannot be guessed.

## 2. Speed source

| Option | Accuracy | Works in tunnels | Cost | Verdict |
|---|---|---|---|---|
| GPS via FusedLocationProvider (`Location.getSpeed`, Doppler-derived) | ±0.5 mph open sky | No | Free | **Primary** |
| OBD-II over Bluetooth (ELM327, PID 0x0D) | Matches dashboard (which reads 2–5% high by design) | Yes | ~$20 adapter + pairing UX | Phase 2 / optional |
| Wheel-speed from CAN | Best | Yes | Requires vehicle-specific integration | Out of scope |

GPS speed is *true ground speed*, generally more accurate than the car's own speedometer.
Weaknesses: tunnels, urban canyons, and a short lag on hard acceleration. Acceptable for a
warning system with a 2–3 second arming window.

Android delivers speed directly on `Location` (`hasSpeed()`), so no position differencing is
needed.

## 3. Speed-limit data — the real constraint

| Provider | Access | Price | Coverage / notes |
|---|---|---|---|
| **TomTom Snap to Roads** (returns speed limits) | Self-serve | **€2.50 / 1,000 requests**, 2,500 free/month | Best cost/coverage. TomTom claims >90% accuracy for ISA compliance; US nationwide. |
| Google Roads API — Speed Limits | **Requires an Asset Tracking license** (limited access) | **$20 / 1,000** (5,000 free/month) | Accurate but 8× TomTom's price and gated behind a license most accounts do not have. |
| HERE Map Attributes v8 (`APPLICABLE_SPEED_LIMIT`) | Enterprise contract | Quote | Best handling of conditional/variable limits. Overkill for v1. |
| OpenStreetMap via Valhalla `trace_attributes` (`edge.speed_limit`) | Free / self-host | €0 + hosting | **Unusable alone in the US: only ~2.11% of OSM ways carry `maxspeed`.** Good as an offline cache for roads we have already resolved. |

**Conclusion:** TomTom is the pragmatic choice. Google is viable only with a license and a
per-segment cache. OSM alone will leave most roads with "unknown limit", which produces the
worst possible UX: silence where the user expects a warning.

### Cost control is an architecture decision, not a billing setting

Do **not** query the limit at 1 Hz. Query **per road segment**:

- Resolve the limit when the vehicle enters a new segment (or every ~15 s while moving).
- Cache by segment/road ID for the trip and persist a regional cache across trips.
- One hour of mixed driving ≈ 40–80 lookups ≈ **€0.10–0.20/hour** on TomTom; the 2,500
  free monthly requests cover roughly 30–60 hours of driving.
- The key must live **server-side** behind a Voxbox API route (same pattern as `/api/tts`),
  never in the APK. That also gives server-side caching, rate limiting, and a kill switch.

## 4. Alert logic — the part that decides whether the feature is liked

Naive: alert every time `speed > limit + 5`. Result: at 5.0 mph over, GPS noise crosses the
threshold several times per second and the app repeats itself until the user uninstalls it.

Required state machine, per band, per road segment:

- **Bands:** +5, +10, +15, +20, +25 … (configurable step; the first "over limit" notice is a
  separate, softer band at +1).
- **Arm delay:** must hold over the band for ~2.5 s before announcing (kills GPS jitter).
- **Hysteresis:** re-arm only after dropping ~2 mph *below* the band for ~5 s.
- **Escalation is immediate:** crossing +10 announces even if +5 was announced 3 s ago.
- **Per-segment reset:** a new speed limit re-arms everything and (optionally) announces the
  new limit once: "Speed limit thirty-five."
- **Cooldown:** the same band cannot repeat within 60 s unless re-armed.
- **Gating:** only while moving forward above ~15 mph, only with acceptable GPS accuracy,
  and never while the limit is unknown/unconfirmed.
- **Chatter budget:** max N announcements per minute (default 3), because a driver who is
  being scolded stops listening.

Suggested phrasing (matches the requested escalation, tightened for speech):

- First over: "Over the limit."
- +5: "You are doing five miles over the speed limit."
- +10: "Ten miles over."
- +15: "Fifteen over — ease off."
- Charge threshold: "Twenty over in Virginia is reckless driving: a Class 1 misdemeanor."

## 5. Charge thresholds — jurisdiction data, with a hard caveat

Reckless-driving by speed is **not** a national rule. Two categories:

- **Hard numeric triggers** (statutory), e.g. **Virginia: 20+ mph over, or over 85 mph
  regardless of the posted limit → reckless driving, Class 1 misdemeanor** (Va. Code
  § 46.2-862). Comparable numeric triggers exist in a minority of states (e.g. 25+ over in
  Colorado, 20+ in Arizona).
- **Discretionary** (most states): "willful or wanton disregard", no mph trigger. Announcing a
  charge here would be wrong.

Therefore:

- Ship a **versioned, dated** per-state table containing only *statutory numeric* triggers,
  each with its citation.
- Announce with hedged phrasing ("possible reckless driving charge in <state>") and a
  one-time spoken/visual disclaimer.
- **Default off** until the user selects their state.
- This is informational, not legal advice. Add it to the terms, not just the UI.
- Never announce a charge in a state whose entry is unverified — stay silent rather than
  guess.

## 6. Voxbox integration

Existing patterns to reuse: local Capacitor plugin (`FullscreenPlugin.java` +
`lib/native/fullscreen*.ts`), server-side proxy for secrets, pure-logic modules with vitest
tests, settings schema in `lib/config/settings.ts`.

### New pieces

| Layer | File | Job |
|---|---|---|
| Native | `android/.../SpeedMonitorPlugin.java` | Foreground service, FusedLocationProvider at 1 Hz, emit `speed` events with speed/accuracy/bearing, permission flow, notification, wake lock. |
| Bridge | `lib/native/speedMonitor.ts` | Capacitor wrapper + injectable fake for tests and replay. |
| Provider | `lib/traffic/speedLimitProvider.ts` | Calls `/api/speedlimit`, segment cache (memory + persisted), offline fallback, "unknown" handling. |
| Policy | `lib/traffic/alertPolicy.ts` | **Pure** state machine: bands, arming, hysteresis, cooldowns, segment resets. Fully unit-testable. |
| Rules | `lib/traffic/chargeRules.ts` + `data/charge-thresholds.json` | State table, versioned, citations. |
| Announcer | `lib/traffic/announcer.ts` | Priority speech queue over the existing `TTSClient`; preempts the assistant, ducks conversation, never queues behind a long answer. |
| Server | `app/api/speedlimit/route.ts` | TomTom proxy + server cache + rate limit + key from env. |
| Settings | `lib/config/settings.ts` → `traffic` block | enabled, units, bands, tolerance, state, chargeWarnings, maxPerMinute. |
| UI | `components/` traffic panel | Large speed readout, current limit, "listening/log-only" indicator. |

### Android specifics (targetSdk 36)

- Permissions: `ACCESS_FINE_LOCATION`, `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`.
- Manifest service: `android:foregroundServiceType="location"`.
- Android 14+: FGS type + Play Console declaration with a **use-case description and demo
  video**. This is the main schedule risk outside our control.
- Battery: 1 Hz high-accuracy GPS ≈ 3–6%/hour. Acceptable for driving; drop to 5 s intervals
  when the vehicle is stationary, and stop the service when the app leaves drive mode.
- Doze/wake lock: the FGS keeps the process alive; still request a partial wake lock for
  screen-off operation.

## 7. Verification strategy

1. **Unit:** `alertPolicy` (arming, hysteresis, escalation, cooldown, segment reset),
   `chargeRules` (state lookup, unknown-state silence), provider cache behaviour.
2. **Replay:** recorded GPS traces fed through the fake bridge; assert the exact spoken
   sequence and that no band repeats.
3. **Emulator:** mock location route with increasing speed; verify announcements and
   service lifecycle.
4. **Shadow mode on device:** run for real drives with speech suppressed, log every
   "would have said X at t=…", then compare against the posted signs. Ship voice only after
   the log looks right.
5. **Data audit:** 20-minute drive in the user's area, every detected limit compared to the
   physical sign. Report accuracy as a number before claiming the feature works.

## 8. Phases

| Phase | Work | Est. |
|---|---|---|
| **P0 — validate data** | TomTom trial key, sample drive, measure accuracy + request count + real cost | 1–2 days |
| **P1 — shadow mode** | Native plugin, provider + cache, policy, settings, log-only UI | 3–4 days |
| **P2 — voice alerts** | Announcer + priority/preemption + settings polish | 2–3 days |
| **P3 — charge warnings** | State table (verified entries only), hedged phrasing, disclaimer | 2 days + legal review |
| **P4 — release** | Permissions, FGS declaration + demo video, internal testing → production | 2–4 days + Play review |

**MVP (P1–P2): 8–12 focused dev days.** Realistic calendar with testing and Play review:
3–4 weeks.

## 9. Decisions needed from the user

1. **Which state(s)?** Determines whether charge warnings are possible at all and which
   citations to verify. Without an answer, P3 ships disabled.
2. **Accept the TomTom subscription?** ~€0.10–0.20/hour of driving, 2,500 free requests/month.
   Google is 8× the price and needs a license; OSM is free but nearly empty in the US.
3. **OBD-II adapter?** Improves tunnel/bridge behaviour and matches the dashboard, at the cost
   of pairing UX and another permission. Recommend deferring to Phase 5.
4. **Alert aggressiveness?** Default: +1 soft, then +5/+10/+15/+20, max 3 announcements/minute.

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Speed-limit data wrong or stale (school zones, construction, recent changes) | Wrong warnings erode trust; possible traffic consequence | Confidence gate, "unknown" state, sign-verification audit, feedback button, disclaimer |
| Play review rejects the location foreground service | Blocks release | Prepare use-case description + demo video up front; the app's core function (driving assistant) is a legitimate navigation-adjacent use case |
| Battery drain complaints | 1-star reviews | 1 Hz only while moving; stop on exit; expose a "battery saver" interval |
| Charge warnings wrong for a state | Legal/trust | Only statutory numeric triggers, cited, hedged, default off, disclaimer |
| Liability framing (app "authorising" speeding) | Legal | Alerts are informational; obey posted signs; no "safe speed" suggestion ever |

## 11. Bottom line

The speed side is easy. The limit side is a **data subscription + caching problem**, solvable
for roughly 10–20 cents per hour of driving with TomTom. The difference between a feature the
user keeps and one they mute is the **alert state machine**, which is pure logic and cheap to
build and test. The charge warnings are a **legal data problem** and should ship last, gated
by state selection, with verified citations only.
