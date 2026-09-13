import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import "session.js" as Session

Item {
  id: root

  property var shell: null
  property var manifest: null

  readonly property string home: Quickshell.env("HOME")
  readonly property string xdgDataHome: Quickshell.env("XDG_DATA_HOME")
  readonly property string dataRoot: xdgDataHome !== "" ? xdgDataHome : home + "/.local/share"
  readonly property string dataDir: dataRoot + "/omafocus"
  readonly property string dataPath: dataDir + "/sessions.json"

  property bool loaded: false
  property bool storageReady: false
  property string fatalError: ""
  property string saveError: ""
  property var document: Session.emptyDocument()
  property var current: null
  property var sessions: []
  property var lastRecap: null
  property int revision: 0
  property int remainingMilliseconds: 0

  property bool writeInFlight: false
  property string writingSnapshot: ""
  property string queuedSnapshot: ""
  property double lastCheckpointAt: 0
  property double lastTickAt: 0
  readonly property int checkpointInterval: 5000
  readonly property int maximumObservedGap: 5000

  readonly property bool ready: loaded && fatalError === ""
  readonly property bool hasCurrent: current !== null
  readonly property bool running: hasCurrent && current.status === "running"
  readonly property bool paused: hasCurrent && current.status === "paused"

  function observedBucket() {
    if (idleMonitor.isIdle) return Session.idleBucket()
    var toplevel = ToplevelManager.activeToplevel
    var appId = toplevel ? String(toplevel.appId || "").trim() : ""
    return appId ? Session.appBucket(appId, appId) : Session.unattributedBucket()
  }

  function setDocument(nextDocument) {
    document = Session.sanitizeDocument(nextDocument)
    current = document.current
    sessions = document.sessions
    remainingMilliseconds = Session.remainingMilliseconds(current, Date.now())
    revision += 1
  }

  function replaceCurrent(nextCurrent) {
    var next = Session.sanitizeDocument(document)
    next.current = nextCurrent
    setDocument(next)
  }

  function loadDocument(raw) {
    if (loaded || fatalError !== "") return
    var parsed = Session.parseDocument(raw)
    if (parsed.error) {
      fatalError = parsed.error + " The file was left untouched: " + dataPath
      return
    }
    var restored = Session.restoreDocument(parsed.document, Date.now(), observedBucket())
    setDocument(restored.document)
    if (restored.record) lastRecap = restored.record
    loaded = true
    lastTickAt = Date.now()
    lastCheckpointAt = lastTickAt
    if (restored.record || current) queueSave()
  }

  function beginFreshDocument() {
    if (loaded || fatalError !== "") return
    setDocument(Session.emptyDocument())
    loaded = true
    lastTickAt = Date.now()
    lastCheckpointAt = lastTickAt
    queueSave()
  }

  function queueSave() {
    if (!ready) return
    queuedSnapshot = Session.serializeDocument(document)
    if (!writeInFlight) flushSave()
  }

  function flushSave() {
    if (!ready || writeInFlight || queuedSnapshot === "") return
    writingSnapshot = queuedSnapshot
    queuedSnapshot = ""
    writeInFlight = true
    stateFile.setText(writingSnapshot)
  }

  function retrySave() {
    if (!ready) return
    saveError = ""
    if (queuedSnapshot === "") queuedSnapshot = Session.serializeDocument(document)
    flushSave()
  }

  function onSaveSucceeded() {
    writeInFlight = false
    writingSnapshot = ""
    saveError = ""
    if (queuedSnapshot !== "") Qt.callLater(flushSave)
  }

  function onSaveFailed(error) {
    writeInFlight = false
    if (queuedSnapshot === "") queuedSnapshot = writingSnapshot
    writingSnapshot = ""
    saveError = "Could not save focus history (" + FileViewError.toString(error) + "). In-memory data is still available; retry before restarting the shell."
  }

  function start(minutes, goal) {
    if (!ready || current || !Session.validDurationMinutes(minutes)) return false
    var now = Date.now()
    var next = Session.startSession(Session.newId(now), goal, Number(minutes), now, observedBucket())
    lastRecap = null
    lastTickAt = now
    lastCheckpointAt = now
    replaceCurrent(next)
    queueSave()
    return true
  }

  function pause() {
    if (!ready || !running) return false
    var now = Date.now()
    if (now >= current.deadline) {
      expire(now)
      return false
    }
    replaceCurrent(Session.pauseSession(current, now))
    queueSave()
    return true
  }

  function resume() {
    if (!ready || !paused) return false
    var now = Date.now()
    replaceCurrent(Session.resumeSession(current, now, observedBucket()))
    lastTickAt = now
    lastCheckpointAt = now
    queueSave()
    return true
  }

  function finishEarly() {
    if (!ready || !current) return false
    var now = Date.now()
    if (running && now >= current.deadline) return expire(now)
    var result = Session.finishDocument(document, "finished-early", now)
    lastRecap = result.record
    setDocument(result.document)
    queueSave()
    return true
  }

  function expire(now) {
    if (!ready || !running) return false
    var result = Session.finishDocument(document, "expired", Math.min(Number(now), current.deadline))
    lastRecap = result.record
    setDocument(result.document)
    queueSave()
    return true
  }

  function cancel() {
    if (!ready || !current) return false
    setDocument(Session.cancelDocument(document))
    queueSave()
    return true
  }

  function clearHistory() {
    if (!ready) return false
    var next = Session.sanitizeDocument(document)
    next.sessions = []
    lastRecap = null
    setDocument(next)
    queueSave()
    return true
  }

  function observeBucket(now) {
    if (!ready || !running) return
    var timestamp = Number(now)
    if (timestamp >= current.deadline) {
      expire(timestamp)
      return
    }
    replaceCurrent(Session.transitionBucket(current, observedBucket(), timestamp))
    queueSave()
  }

  function prepareForSleep(sleeping) {
    if (!ready || !running) return
    var now = Date.now()
    if (sleeping) {
      var settled = Session.transitionBucket(current, Session.unattributedBucket(), now)
      settled.bucket = Session.unattributedBucket()
      replaceCurrent(settled)
      lastTickAt = now
      queueSave()
    } else {
      tick(now)
      if (running) {
        var resumed = Session.transitionBucket(current, observedBucket(), now)
        resumed.bucket = observedBucket()
        replaceCurrent(resumed)
        queueSave()
      }
    }
  }

  function tick(nowValue) {
    var now = Number(nowValue)
    remainingMilliseconds = Session.remainingMilliseconds(current, now)
    if (!ready || !running) {
      lastTickAt = now
      return
    }

    var next
    if (lastTickAt > 0 && now < lastTickAt) {
      next = Session.shiftBackwardClock(current, now, lastTickAt)
    } else if (lastTickAt > 0 && now - lastTickAt > maximumObservedGap) {
      next = Session.settleUnattributedGap(current, now, "discontinuity")
      if (now < next.deadline) next.bucket = observedBucket()
    } else {
      next = Session.settle(current, now)
    }
    replaceCurrent(next)
    lastTickAt = now

    if (now >= next.deadline) {
      expire(now)
      return
    }
    if (now - lastCheckpointAt >= checkpointInterval || now < lastCheckpointAt) {
      lastCheckpointAt = now
      queueSave()
    }
  }

  function periodSessions(period) {
    revision
    return Session.sessionsForPeriod(sessions, period, Date.now())
  }

  function periodAggregate(period) {
    return Session.aggregate(periodSessions(period))
  }

  function durationRows(value) {
    return Session.durationRows(value)
  }

  function formatDuration(milliseconds) {
    var seconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000))
    var hours = Math.floor(seconds / 3600)
    var minutes = Math.floor((seconds % 3600) / 60)
    var remainder = seconds % 60
    if (hours > 0) return hours + "h " + String(minutes).padStart(2, "0") + "m"
    return minutes + ":" + String(remainder).padStart(2, "0")
  }

  function formatClock(milliseconds) {
    var seconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000))
    var hours = Math.floor(seconds / 3600)
    var minutes = Math.floor((seconds % 3600) / 60)
    var remainder = seconds % 60
    return hours > 0
      ? hours + ":" + String(minutes).padStart(2, "0") + ":" + String(remainder).padStart(2, "0")
      : String(minutes).padStart(2, "0") + ":" + String(remainder).padStart(2, "0")
  }

  Process {
    id: ensureDataDir
    command: ["mkdir", "-p", root.dataDir]
    onExited: function(exitCode) {
      if (exitCode === 0) {
        root.storageReady = true
        Qt.callLater(stateFile.reload)
      }
      else root.fatalError = "Could not create the data directory: " + root.dataDir
    }
  }

  FileView {
    id: stateFile
    path: root.storageReady ? root.dataPath : ""
    watchChanges: false
    atomicWrites: true
    printErrors: false
    onLoaded: root.loadDocument(text())
    onLoadFailed: function(error) {
      if (!root.storageReady) return
      if (error === FileViewError.FileNotFound) root.beginFreshDocument()
      else root.fatalError = "Could not read " + root.dataPath + " (" + FileViewError.toString(error) + "). The file was left untouched."
    }
    onSaved: root.onSaveSucceeded()
    onSaveFailed: function(error) { root.onSaveFailed(error) }
  }

  IdleMonitor {
    id: idleMonitor
    enabled: true
    timeout: 60000
    respectInhibitors: false
    onIsIdleChanged: root.observeBucket(Date.now())
  }

  Connections {
    target: ToplevelManager
    function onActiveToplevelChanged() { root.observeBucket(Date.now()) }
  }

  Timer {
    interval: 1000
    repeat: true
    running: true
    onTriggered: root.tick(Date.now())
  }

  property bool awaitingSleepValue: false

  Process {
    id: sleepMonitor
    command: [
      "dbus-monitor",
      "--system",
      "type='signal',interface='org.freedesktop.login1.Manager',member='PrepareForSleep'"
    ]
    stdout: SplitParser {
      onRead: function(line) {
        var text = String(line || "")
        if (text.indexOf("member=PrepareForSleep") !== -1) {
          root.awaitingSleepValue = true
        } else if (root.awaitingSleepValue && text.indexOf("boolean ") !== -1) {
          root.awaitingSleepValue = false
          root.prepareForSleep(text.indexOf("boolean true") !== -1)
        }
      }
    }
    onExited: sleepMonitorRestart.restart()
  }

  Timer {
    id: sleepMonitorRestart
    interval: 2000
    onTriggered: sleepMonitor.running = true
  }

  Component.onCompleted: {
    ensureDataDir.running = true
    sleepMonitor.running = true
  }
}
