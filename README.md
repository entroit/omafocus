# Oma Focus

Oma Focus answers one question: where did the time in this focus session go?

It adds a countdown to the stock Omarchy bar, tracks time by focused
application, and saves a flat recap when the session ends. Idle and
unattributed time remain visible instead of being assigned to whichever app
happened to be focused last.

> **Development status:** v0.1 is being tested on Omarchy 4.0.3-1,
> Quickshell 0.3.1, and Hyprland 0.56.2. The deterministic checks pass, but the
> full manual acceptance pass is not complete yet.

## Install

Oma Focus targets the stock Omarchy bar. Install and enable it from its public
repository:

```sh
omarchy plugin add https://github.com/entroit/omafocus.git --enable --yes
```

The service is shared by every monitor. Bar-widget code reloads when plugin
files change. The persistent service uses `keepLoaded`, so restart the shell to
pick up changes to `src/Service.qml`:

```sh
omarchy restart shell
```

Update an installed checkout with:

```sh
omarchy plugin update entroit.omafocus --yes
```

## How accounting works

Oma Focus counts integer milliseconds and rounds only for display. A session
can be running or paused. Pause time is excluded. Finishing early saves a
record; canceling does not.

The current bucket is one of these values:

- the focused application's stable app ID;
- `Idle`, beginning when Quickshell reports 60 seconds without input;
- `Unattributed`, used when focus is missing or an observation gap cannot be
  trusted.

Idle monitoring ignores screen-blanking inhibitors. Reading without touching
the keyboard or pointer can therefore count as idle. Oma Focus listens for
logind's `PrepareForSleep` signal and moves suspended time to `Unattributed`.
It also treats a gap of more than five seconds between service ticks as
unattributed, which covers missed suspend signals and long clock jumps without
inventing app precision. The countdown uses wall-clock time, so it continues
through suspend.

On restart, a running session's unobserved gap is capped at its deadline and
added to `Unattributed`. A paused session gains no time. Five-second
checkpoints mean a crash can still lose a recent action. The recap flags
recovery and clock gaps when they occur.

History periods use the current local timezone and assign the whole session to
the date on which it started. Weeks begin Monday. Cross-midnight sessions are
not split.

## Privacy and storage

Everything stays on this computer. Oma Focus stores application IDs, display
names, totals, timestamps, outcomes, and optional goals. It does not collect
window titles, URLs, raw window events, accounts, telemetry, or sync data.

Goals are saved as plain text and may contain sensitive material. Leave the
goal blank when that is a concern.

The data file is:

```text
$XDG_DATA_HOME/omafocus/sessions.json
```

When `XDG_DATA_HOME` is empty or unset, Oma Focus uses:

```text
$HOME/.local/share/omafocus/sessions.json
```

To export manually, close or pause the current session and copy that JSON file.
The panel can clear saved history with one confirmed action; it leaves an
active session alone.

## Development

The repository root is the installable plugin. No build step or runtime package
manager is involved.

Run the deterministic accounting checks with Node 24:

```sh
TZ=Europe/Berlin node test/session-test.js
```

Validate the manifest with the installed Omarchy CLI:

```sh
omarchy plugin validate .
```

The stock shell uses virtual `qs.Ui` and `qs.Commons` import paths. Give
`qmllint` a temporary matching layout:

```sh
lint_imports=$(mktemp -d)
mkdir -p "$lint_imports/qs"
ln -s "$OMARCHY_PATH/shell/Ui" "$lint_imports/qs/Ui"
ln -s "$OMARCHY_PATH/shell/Commons" "$lint_imports/qs/Commons"
/usr/lib/qt6/bin/qmllint -I "$lint_imports" src/Service.qml src/BarWidget.qml src/Panel.qml
rm -r "$lint_imports"
```

The pure accounting code receives every timestamp explicitly. Tests use only
synthetic goals and sessions. They cover app switches, idle time,
pause/resume, deadlines, recovery, clock changes, privacy filtering, local
calendar boundaries, daylight-saving time, and 5,000-session responsiveness.

### Verification record

Checked on 2026-09-13:

- manifest validation: passed;
- deterministic test suite: passed;
- 5,000-session serialize/parse/aggregate check: 20.2 ms;
- logind `PrepareForSleep` signal: present;
- first-run atomic file creation with a disposable data directory: passed;
- start, checkpoint, finish, and saved recap through the QML service: passed;
- restart recovery with the gap assigned to `Unattributed`: passed;
- malformed and newer-schema files stayed unchanged and disabled actions: passed;
- failed atomic write stayed visible in memory; retry after repair: passed;
- fresh install and update from the public Git URL: passed;
- real suspend/resume: not tested;
- second monitor: not tested;
- interrupted atomic replacement: not tested;
- deletion while another save is pending: not tested.

Do not treat an untested item as a pass. Release `v0.1.0` only after the manual
checks in the issue or release PR cover focus changes, the real idle threshold,
closed-panel expiration, hot reload, restart recovery, multiple monitors, and
suspend/resume.

## Contributing

Open an issue before starting a large change. Keep the code flat and the
accounting direct. Add a regression case when a bug exposes a missing behavior.
Do not commit real session goals, titles, URLs, or browsing data in examples,
tests, screenshots, or logs.

## License

Oma Focus is available under the [MIT License](LICENSE).
