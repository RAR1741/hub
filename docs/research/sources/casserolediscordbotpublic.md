# RobotCasserole1736/CasseroleDiscordBotPublic — Source Survey

**Repo:** RobotCasserole1736/CasseroleDiscordBotPublic — https://github.com/RobotCasserole1736/CasseroleDiscordBotPublic
**Surveyed-at:** 171b86d304b01dfb24cd240f72425bd46cfd92eb
**Permalink form:** https://github.com/RobotCasserole1736/CasseroleDiscordBotPublic/blob/171b86d304b01dfb24cd240f72425bd46cfd92eb/<path>
**Stack:** Python 3, discord.py (a vendored fork by `imayhaveborkedit` adding voice-receive `listen()` support, checked directly into the repo under `discord/`), `fuzzywuzzy`, `markovify`, `tbapy` (The Blue Alliance client), `sounddevice`, Tkinter (unused GUI stub), runs on a Raspberry Pi 3B as a systemd service (`casseroleBot.service`). No database — one flat text file for "remembered facts" (incomplete).
**License:** MIT (LICENSE file present at repo root) — free to reuse/adapt directly, not merely ideas-only. Note the vendored `discord/` directory is a third-party fork of discord.py carried in-tree; that dependency's own license (MIT, per discord.py upstream) travels with it but wasn't separately re-verified here.
**Last activity:** 2022-12-08 (`pushed_at`); latest commit is also the HEAD used above.
**FRC team:** 1736 (Robot Casserole) — explicit in repo name, `casserole.jpg`, and cheer strings ("17" → "36!").
**Areas:** communication (Discord bot); third-party integrations (The Blue Alliance)

## Purpose
A Discord bot that doubles as a physical conference-room phone: it bridges a hardware VoIP-style handset (Revolabs FLX USB speakerphone) into a Discord voice channel so people in the shop can dial into "Team Meetings" or "Mentor Meetings" without a laptop, while also acting as a chatty, team-spirit Discord bot (cheer call-and-response, TBA team lookups, and Markov-chain-generated filler banter when it doesn't understand a message).

## Auth & Roles
None. Any Discord user who @-mentions the bot or prefixes a message with `$` can issue any command (call in, hang up, hold, reboot the host Pi). No allow-list, no per-guild config, no role checks — trust is implicit (private team server). The bot logs in with a single bot token from an external `APIKeys.py` (not in the repo, imported via `sys.path.append("..")`), so secrets are kept out of source control by convention rather than tooling.

## Data Model
No database. State is entirely in-memory Python object attributes on the bot client (`casseroleBot.py`): connection state (`connectRequest`/`isConnected`), hold state, current voice channel, previous physical-button press counts. One planned but broken exception: `rememberThings.py` sketches a `ThingRememberer` class meant to persist arbitrary "remember that X" facts to a flat file `things_remembered.txt`, but the file as committed has a syntax error (an `if` with no body/colon-completion) and is never imported by the main bot — dead/unfinished code.

## Features

### Communication (Discord bot / voice bridge)
- Mention- or `$`-prefixed command parsing, plus a standing "yay" cheer trigger, in `on_message` — `casseroleBot.py`.
- **Fuzzy natural-language command routing** instead of rigid slash commands: `fuzzyResponseParser.py` uses `fuzzywuzzy` (`partial_ratio` × `token_sort_ratio` × `token_set_ratio`, combined multiplicatively) to score free-text like "please cal in to the mentor channel" against known command phrase lists, with a confidence floor (15%) below which it falls back to unknown.
- **Voice-channel phone bridge**: connects the bot to either the "Team Meetings" or "Mentor Meetings" Discord voice channel, plays live microphone audio into it, and listens for/forwards incoming voice — `audioHandling.py` (`MicrophoneAudioSource`, `SpeakerAudioSink` using `sounddevice`), driven from `casseroleBot.py` (`_voiceConnect`, `hangUp`).
- **Hold/mute**: toggles between live mic passthrrandom and one of two on-hold WAV loops (`hold1.wav`, `hold2.wav`) chosen at random — `casseroleBot.py` (`enableHold`/`disableHold`).
- **Physical hardware control surface**: reverse-engineered USB HID interface to a Revolabs FLX 1500 conference speakerphone, polling its call/mute buttons and (intended, partly commented out) driving its status LEDs — `revolabsFLXInterface.py`, `hidDefs.py`. Explicitly documented in the README as undocumented-vendor-protocol reverse engineering from raw Linux HID byte streams, Linux-only.
- **Remote reboot**: a recognized voice/text command runs `sudo reboot` on the host Pi (`casseroleBot.py`, `periodicStateCheck`) — no confirmation step, and requires the service account to have passwordless sudo (flagged as "yucky" in the README itself).
- **Cheer call-and-response**: a fixed table of team cheer call/response pairs ("Robot" → "Casserole!", "17" → "36!", etc.) plus a stateful "give me a ___ / what does that spell?" spell-out cheer — `cheerHandler.py`.
- **Conversational filler via Markov chain**: when no command/cheer matches, generates a pseudo-sentence from a Markov model (`markovify`, POS-tagged via a custom `POSifiedText` in `markovChainGen/posify.py`) trained offline on scraped Chief Delphi forum text (`markovChainGen/CDmarkovModel.json`, built by `markovChainGen/chiefDelphi.py` + `markovGenerate.py`) — gives the bot an "I don't know but I'll bluff" personality rather than a canned "sorry, I don't understand."
- Built-in `help` command listing the phone commands (`casseroleBot.py`, `helpStr`).

### Third-party integrations
- **The Blue Alliance lookup**: `who is <team number>` regex-matched in chat resolves to the team's nickname via `tbapy` — `theBlueAlliance.py` (`TBAInfo.lookupTeamName`), keyed by a `TBA_KEY` in the external `APIKeys` module.

## Integrations
Discord (bot, voice channels, custom voice-receive fork of discord.py), The Blue Alliance (`tbapy`), local audio hardware (`sounddevice` mic/speaker I/O), a specific USB conference-phone device (Revolabs FLX 1500) via raw HID.

## Notable Implementation Details
- Ships a **vendored fork of discord.py** wholesale (the entire `discord/` package, ~35 files) rather than pinning a package version, because upstream discord.py at the time lacked a voice-receive (`listen()`) API; the README explains this was necessary and cites the upstream RFC discussion. A re-implementer today should just use a current discord.py/py-cord, which has native voice-receive support, and drop this pattern entirely — it's the single biggest piece of this repo's size and is 100% throwaway.
- The Markov-chain "flail if confused" fallback (trained on scraped forum text) is a distinctive personality trick worth stealing conceptually for any team bot: rather than a static "I don't understand," it always says *something* plausible-sounding, with a Star Wars monologue as the ultimate fallback if even the Markov model produces nothing.
- Fuzzy-match command parsing (multiplying three separate `fuzzywuzzy` similarity scores) is a lightweight, dependency-light alternative to full NLU/intent classification for a small fixed command set — cheap to reimplement, no ML training required.
- Hardware control (`sudo reboot`, raw HID polling, real audio I/O) means this bot is designed to run as a dedicated always-on process on the physical Pi, not as a generic hosted cloud bot — port this repo's "phone bridge" idea only if a team has equivalent handset hardware; the Discord-bot/chat parts are hardware-independent and portable.
- `rememberThings.py` is dead code with a syntax error — not wired into the bot, not a working feature, but signals an intended "remember arbitrary facts" capability that was never finished.
- No tests, no CI, no requirements pinning beyond a flat `requirements.txt`.

## Verdict
Substantive and MIT-licensed, but the areas in scope here are narrow: it's a genuinely novel physical-phone/Discord-voice-bridge plus a team-spirit chatbot, not a team-ops tool for attendance/rosters/parts/POs. Worth stealing: the fuzzy free-text command parser and the "always answer with something plausible" Markov fallback for chat bots; the TBA team-lookup pattern is a trivial, common integration. The voice-hardware-bridge and vendored discord.py fork are not worth reusing as-is.
