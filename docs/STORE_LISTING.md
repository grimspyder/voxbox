# STORE_LISTING — Voxbox Retro AI

Everything the Play listing needs, with the naming decision and its reasons recorded so a
reviewer, a lawyer or a future maintainer can see why each word is the word.

## Identity

| Field | Value | Limit | Notes |
|---|---|---|---|
| Play listing title | **Voxbox Retro AI** | 30 chars | 16 characters. No emoji, no repeated special characters, not all-caps, no ranking/price/promo wording (Play metadata policy). |
| Launcher label (on-device) | **Voxbox** | — | `strings.xml` `app_name`. Kept short because Android launchers truncate; the store title and the launcher label are allowed to differ. |
| Package name | **com.grimspyder.voxbox** | — | Renamed from `com.grimspyder.kittassistant` *before* registration, because the package appears in the public store URL. Permanent once registered. |
| In-app persona name | **Vox** | — | The assistant calls itself Vox, not the app name, which reads better out loud. |
| Category | Entertainment (primary), Tools (secondary) | — | It is a conversational entertainment app, not a utility. |
| Contact email | *owner to supply* | — | Required by Play. |
| Privacy policy URL | *owner to supply* | — | Required by Play; must match `docs/PRIVACY_POLICY.md`. |

## Why this name, and why not the obvious ones

**Rejected: `VoxBox` on its own.** Three apps already carry that exact name on Play, one of them a
1M-download AI voice app (`com.voxbox.android`, Shenzhen iMyfone) — the same category as this app.
Play does not enforce name uniqueness, so it would not have been rejected outright, but shipping a
same-named AI voice app next to an established one invites a confusion complaint from a larger
neighbour and loses every search. **`Voxbox Retro AI`** keeps the owner's chosen name and clears the
confusion test by adding a distinctiveness layer.

**Rejected: any use of the inspiration's names** — the franchise name, the character name and its
initials, the vehicle designation, the fictional company, or the antagonist's name — as the title,
launcher label, icon, developer name, package name, or in the shipped persona. Reasons:

- Play's **Impersonation** policy forbids implying that an app is related to, authorised by or
  official without the rights to say so, and a disclaimer does not create those rights.
- Play's **Intellectual Property** policy treats unauthorised trademark use *likely to cause
  confusion* as grounds for suspension or removal, and explicitly includes fan art.
- Using the name as the product brand is the clearest form of confusing use, so it is the first
  thing to remove. The persona, the visual style and the *ideas* behind the app are not names,
  logos or recorded performances, so those stay.

**Rejected: calling it a parody of the inspiration.** Trademark parody protects uses that comment
on or criticise the original. This app is a tribute that uses the character's identity as its
appeal, which is the opposite fact pattern, and Play has no parody carve-out to invoke. The framing
that *is* accurate and useful is "independent homage to 1980s talking-vehicle science fiction",
which is what the copy below says.

## Short description (80 characters max)

```
Talk with a retro voice AI. Red LED modulator, your own AI service.
```

68 characters. No "free", no ranking claims, no keyword stuffing.

## Full description (4000 characters max)

```
Meet Vox — a calm, precise, quietly witty voice companion with a face made of red LEDs.

Voxbox Retro AI is a voice-first conversation app with the feel of a 1980s talking-vehicle
computer. Press start, speak, and Vox answers out loud while a three-column LED voice modulator
moves in time with his voice — centre bars lighting first, exactly like the hardware it's modelled
on in spirit.

TRY IT WITHOUT ANY SETUP
Open the app and press "Try it now". Demo mode needs no account and no API key: Vox replies in a
voice synthesised on your own device, and the full LED display works. It even works offline.

CONNECT YOUR OWN AI FOR FULL CONVERSATION
If you want real conversation, connect your own AI service. Voxbox supports OpenAI, OpenRouter,
Anthropic and Google Gemini for the intelligence, and OpenAI or ElevenLabs for the voice. Setup is
four short steps in plain language: pick a service, paste your key, choose how Vox sounds, and test
the microphone. You are billed by your own provider, not by us, and you can change or delete your
key at any time.

MADE TO BE TALKED TO, NOT TAPPED AT
• Hands-free conversation with automatic end-of-turn detection
• Interrupt Vox the moment you want to say something
• Type instead whenever speaking isn't convenient
• A live microphone meter so you can see Vox is hearing you
• Portrait and landscape, phone-first layout

A RETRO DISPLAY THAT ISN'T A COSTUME
The interface is an original recreation: three columns of LED segments, illuminated from the centre
outwards, driven only by Vox's own voice output — your microphone never makes the lights move, so
you always know when he is speaking.

YOUR DATA STAYS YOURS
The microphone is open only while you are talking with Vox, and it closes the moment you stop.
Nothing listens in the background. Your keys are used to make the request you asked for and are
never stored on our servers or written to logs. Conversation history lives on your device, and you
can delete it, or your keys, independently at any time. Full details: see the privacy policy.

Honest details worth knowing before you install:
• Full conversation needs your own third-party AI key; demo mode needs nothing.
• Audio is processed either on your device or by the speech service you choose.
• The LED bar display is decorative. Vox does not control any vehicle, appliance or emergency
  service, and he will tell you so if you ask.

Voxbox Retro AI is an independent app. It is not affiliated with, endorsed by, sponsored by or
licensed by any rights holder of the films or television series that inspired its retro styling,
and it contains no audio, imagery, footage or voice recordings from any such work.
```

## Words that must never appear in the listing

The franchise name, the character name or initials, the vehicle designation, the fictional company,
the antagonist's name, the car marque or model, any actor's name or likeness, "official", "licensed",
"authorised", "endorsed", "the real", "as seen on TV", and any screenshot, still or audio clip from
any television series or film.

## Store assets

| Asset | Status | Notes |
|---|---|---|
| App icon 512×512 | Generated | `docs/store/play-icon-512.png`, produced from `assets/branding/voxbox-icon.svg` by `npm run icons`. Original vector art: the three-bar modulator on black. |
| Feature graphic 1024×500 | To do | Must also be original; must not use franchise styling or the show's logotype. |
| Phone screenshots (min 2, up to 8) | To do | Dashboard, active conversation with the modulator lit, the setup wizard, the system-check screen. Capture from the real build on a device, not a mock-up. |
| AI-generated asset declaration | To do | If any asset is AI-generated, complete Play's current AI asset declaration at submission time. |
| Content rating | To do | Answer from the app's actual possible output; it is a generative conversational app. |

## Voice and likeness

Ships one voice: an original synthesis generated at runtime in Web Audio (see
`lib/tts/client.ts`). No actor's voice is cloned, sampled or approximated from a recording, and no
third-party voice sample is bundled. Users who connect their own voice provider are choosing a
voice from *their* account, and the app describes it as a custom voice rather than as anyone
official.
