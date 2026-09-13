/*
 * Pure session accounting for both QML and the deterministic Node test.
 * Every public transition returns a copy and receives time explicitly.
 */

var SCHEMA_VERSION = 1
var MINUTE = 60000

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function finiteInteger(value, fallback) {
  var number = Number(value)
  return isFinite(number) ? Math.floor(number) : fallback
}

function cleanText(value) {
  return String(value === undefined || value === null ? "" : value)
}

function emptyDocument() {
  return { schemaVersion: SCHEMA_VERSION, current: null, sessions: [] }
}

function appBucket(appId, name) {
  var id = cleanText(appId).trim()
  if (!id) return unattributedBucket()
  return { kind: "app", appId: id, name: cleanText(name).trim() || id }
}

function idleBucket() {
  return { kind: "idle" }
}

function unattributedBucket() {
  return { kind: "unattributed" }
}

function normalizeBucket(value) {
  if (!value || value.kind === "unattributed") return unattributedBucket()
  if (value.kind === "idle") return idleBucket()
  if (value.kind === "app") return appBucket(value.appId, value.name)
  return unattributedBucket()
}

function sameBucket(left, right) {
  var a = normalizeBucket(left)
  var b = normalizeBucket(right)
  if (a.kind !== b.kind) return false
  return a.kind !== "app" || a.appId === b.appId
}

function validDurationMinutes(minutes) {
  var value = Number(minutes)
  return isFinite(value) && Math.floor(value) === value && value >= 1 && value <= 240
}

function newId(now, randomPart) {
  var suffix = cleanText(randomPart || Math.random().toString(36).slice(2, 10))
  return "omafocus-" + finiteInteger(now, Date.now()) + "-" + suffix
}

function startSession(id, goal, minutes, now, initialBucket) {
  if (!validDurationMinutes(minutes)) throw new Error("Duration must be a whole number from 1 to 240 minutes.")
  var timestamp = finiteInteger(now, NaN)
  if (!isFinite(timestamp) || timestamp < 0) throw new Error("Start time must be a non-negative integer.")
  var planned = Number(minutes) * MINUTE
  return {
    id: cleanText(id) || newId(timestamp),
    goal: cleanText(goal),
    plannedMilliseconds: planned,
    startedAt: timestamp,
    status: "running",
    deadline: timestamp + planned,
    pausedRemainingMilliseconds: null,
    settledThrough: timestamp,
    bucket: normalizeBucket(initialBucket),
    elapsedMilliseconds: 0,
    idleMilliseconds: 0,
    unattributedMilliseconds: 0,
    apps: {},
    recoveryMilliseconds: 0,
    discontinuityMilliseconds: 0,
    clockDiscontinuities: 0
  }
}

function normalizeApps(value) {
  var out = {}
  if (!value || typeof value !== "object" || Array.isArray(value)) return out
  for (var id in value) {
    if (!Object.prototype.hasOwnProperty.call(value, id)) continue
    var row = value[id]
    var key = cleanText(id).trim()
    if (!key || !row || typeof row !== "object") continue
    out[key] = {
      name: cleanText(row.name).trim() || key,
      milliseconds: Math.max(0, finiteInteger(row.milliseconds, 0))
    }
  }
  return out
}

function credit(session, bucket, milliseconds) {
  var amount = Math.max(0, finiteInteger(milliseconds, 0))
  if (!amount) return session
  var target = normalizeBucket(bucket)
  session.elapsedMilliseconds += amount
  if (target.kind === "idle") {
    session.idleMilliseconds += amount
  } else if (target.kind === "unattributed") {
    session.unattributedMilliseconds += amount
  } else {
    var apps = clone(session.apps) || {}
    var row = apps[target.appId] || { name: target.name || target.appId, milliseconds: 0 }
    row.name = target.name || row.name || target.appId
    row.milliseconds = Math.max(0, finiteInteger(row.milliseconds, 0)) + amount
    apps[target.appId] = row
    session.apps = apps
  }
  return session
}

function settle(current, now, bucketOverride) {
  if (!current || current.status !== "running") return clone(current)
  var session = clone(current)
  var timestamp = finiteInteger(now, session.settledThrough)
  if (timestamp < session.settledThrough) {
    session.clockDiscontinuities += 1
    session.discontinuityMilliseconds += session.settledThrough - timestamp
    return session
  }
  var end = Math.min(timestamp, session.deadline)
  var delta = Math.max(0, end - session.settledThrough)
  credit(session, bucketOverride || session.bucket, delta)
  session.settledThrough = end
  return session
}

function transitionBucket(current, nextBucket, now) {
  if (!current || current.status !== "running") return clone(current)
  var session = settle(current, now)
  if (session.settledThrough < session.deadline && !sameBucket(session.bucket, nextBucket))
    session.bucket = normalizeBucket(nextBucket)
  return session
}

function settleUnattributedGap(current, now, reason) {
  if (!current || current.status !== "running") return clone(current)
  var before = current.unattributedMilliseconds || 0
  var session = settle(current, now, unattributedBucket())
  var added = Math.max(0, session.unattributedMilliseconds - before)
  if (reason === "recovery") session.recoveryMilliseconds += added
  else session.discontinuityMilliseconds += added
  return session
}

function shiftBackwardClock(current, now, previousNow) {
  if (!current || current.status !== "running") return clone(current)
  var timestamp = finiteInteger(now, current.settledThrough)
  var previous = finiteInteger(previousNow, current.settledThrough)
  if (timestamp >= previous) return clone(current)
  var session = clone(current)
  var remainingAtPrevious = Math.max(0, session.deadline - previous)
  session.deadline = timestamp + remainingAtPrevious
  session.settledThrough = timestamp
  session.clockDiscontinuities += 1
  session.discontinuityMilliseconds += previous - timestamp
  return session
}

function remainingMilliseconds(current, now) {
  if (!current) return 0
  if (current.status === "paused") return Math.max(0, finiteInteger(current.pausedRemainingMilliseconds, 0))
  return Math.max(0, finiteInteger(current.deadline, 0) - finiteInteger(now, current.settledThrough))
}

function pauseSession(current, now) {
  if (!current || current.status !== "running") return clone(current)
  var session = settle(current, now)
  var remaining = Math.max(0, session.deadline - Math.min(finiteInteger(now, session.settledThrough), session.deadline))
  session.status = "paused"
  session.pausedRemainingMilliseconds = remaining
  session.deadline = null
  session.bucket = unattributedBucket()
  return session
}

function resumeSession(current, now, initialBucket) {
  if (!current || current.status !== "paused") return clone(current)
  var session = clone(current)
  var timestamp = finiteInteger(now, NaN)
  if (!isFinite(timestamp)) throw new Error("Resume time must be an integer.")
  var remaining = Math.max(0, finiteInteger(session.pausedRemainingMilliseconds, 0))
  session.status = "running"
  session.deadline = timestamp + remaining
  session.pausedRemainingMilliseconds = null
  session.settledThrough = timestamp
  session.bucket = normalizeBucket(initialBucket)
  return session
}

function sanitizeCurrent(value) {
  if (!value || typeof value !== "object") return null
  var status = value.status === "paused" ? "paused" : "running"
  var planned = Math.max(0, finiteInteger(value.plannedMilliseconds, 0))
  var started = Math.max(0, finiteInteger(value.startedAt, 0))
  var elapsed = Math.max(0, finiteInteger(value.elapsedMilliseconds, 0))
  var idle = Math.max(0, finiteInteger(value.idleMilliseconds, 0))
  var unattributed = Math.max(0, finiteInteger(value.unattributedMilliseconds, 0))
  var current = {
    id: cleanText(value.id),
    goal: cleanText(value.goal),
    plannedMilliseconds: planned,
    startedAt: started,
    status: status,
    deadline: status === "running" ? Math.max(0, finiteInteger(value.deadline, started + planned)) : null,
    pausedRemainingMilliseconds: status === "paused" ? Math.max(0, finiteInteger(value.pausedRemainingMilliseconds, 0)) : null,
    settledThrough: Math.max(started, finiteInteger(value.settledThrough, started)),
    bucket: normalizeBucket(value.bucket),
    elapsedMilliseconds: elapsed,
    idleMilliseconds: idle,
    unattributedMilliseconds: unattributed,
    apps: normalizeApps(value.apps),
    recoveryMilliseconds: Math.max(0, finiteInteger(value.recoveryMilliseconds, 0)),
    discontinuityMilliseconds: Math.max(0, finiteInteger(value.discontinuityMilliseconds, 0)),
    clockDiscontinuities: Math.max(0, finiteInteger(value.clockDiscontinuities, 0))
  }
  if (!current.id || planned < MINUTE || planned > 240 * MINUTE) return null
  return current
}

function totalAppMilliseconds(apps) {
  var total = 0
  var value = apps || {}
  for (var id in value)
    if (Object.prototype.hasOwnProperty.call(value, id)) total += Math.max(0, finiteInteger(value[id].milliseconds, 0))
  return total
}

function invariant(current) {
  if (!current) return true
  return totalAppMilliseconds(current.apps) + current.idleMilliseconds + current.unattributedMilliseconds === current.elapsedMilliseconds
}

function recordFromCurrent(current, outcome, endedAt) {
  var session = sanitizeCurrent(current)
  if (!session || !invariant(session)) throw new Error("Session accounting is not balanced.")
  return {
    id: session.id,
    goal: session.goal,
    plannedMilliseconds: session.plannedMilliseconds,
    startedAt: session.startedAt,
    endedAt: Math.max(session.startedAt, finiteInteger(endedAt, session.settledThrough)),
    outcome: outcome === "expired" ? "expired" : "finished-early",
    elapsedMilliseconds: session.elapsedMilliseconds,
    idleMilliseconds: session.idleMilliseconds,
    unattributedMilliseconds: session.unattributedMilliseconds,
    apps: normalizeApps(session.apps),
    recoveryMilliseconds: session.recoveryMilliseconds,
    discontinuityMilliseconds: session.discontinuityMilliseconds,
    clockDiscontinuities: session.clockDiscontinuities
  }
}

function normalizeRecord(value) {
  if (!value || typeof value !== "object") return null
  var currentLike = sanitizeCurrent({
    id: value.id,
    goal: value.goal,
    plannedMilliseconds: value.plannedMilliseconds,
    startedAt: value.startedAt,
    status: "paused",
    pausedRemainingMilliseconds: 0,
    settledThrough: value.endedAt,
    elapsedMilliseconds: value.elapsedMilliseconds,
    idleMilliseconds: value.idleMilliseconds,
    unattributedMilliseconds: value.unattributedMilliseconds,
    apps: value.apps,
    recoveryMilliseconds: value.recoveryMilliseconds,
    discontinuityMilliseconds: value.discontinuityMilliseconds,
    clockDiscontinuities: value.clockDiscontinuities
  })
  if (!currentLike || !invariant(currentLike)) return null
  return recordFromCurrent(currentLike, value.outcome, value.endedAt)
}

function addRecordOnce(document, record) {
  var doc = clone(document) || emptyDocument()
  if (!Array.isArray(doc.sessions)) doc.sessions = []
  for (var i = 0; i < doc.sessions.length; i++)
    if (doc.sessions[i] && doc.sessions[i].id === record.id) return doc
  doc.sessions.unshift(clone(record))
  return doc
}

function finishDocument(document, outcome, now) {
  var doc = clone(document) || emptyDocument()
  if (!doc.current) return { document: doc, record: null }
  var timestamp = finiteInteger(now, doc.current.settledThrough)
  var settled = doc.current.status === "running" ? settle(doc.current, timestamp) : clone(doc.current)
  var end = settled.status === "running" ? Math.min(timestamp, settled.deadline) : timestamp
  var record = recordFromCurrent(settled, outcome, end)
  doc = addRecordOnce(doc, record)
  doc.current = null
  return { document: doc, record: record }
}

function cancelDocument(document) {
  var doc = clone(document) || emptyDocument()
  doc.current = null
  return doc
}

function sanitizeDocument(document) {
  var source = document || {}
  var out = emptyDocument()
  out.current = sanitizeCurrent(source.current)
  var sessions = Array.isArray(source.sessions) ? source.sessions : []
  var seen = {}
  for (var i = 0; i < sessions.length; i++) {
    var record = normalizeRecord(sessions[i])
    if (record && !seen[record.id]) {
      out.sessions.push(record)
      seen[record.id] = true
    }
  }
  return out
}

function parseDocument(raw) {
  var parsed
  try {
    parsed = JSON.parse(cleanText(raw))
  } catch (error) {
    return { error: "History is not valid JSON: " + error, document: null }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { error: "History must contain a JSON object.", document: null }
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    var label = parsed.schemaVersion > SCHEMA_VERSION ? "newer" : "unsupported"
    return { error: "History uses a " + label + " schema version (" + parsed.schemaVersion + ").", document: null }
  }
  var document = sanitizeDocument(parsed)
  if (parsed.current && !document.current)
    return { error: "The saved active session is invalid.", document: null }
  return { error: "", document: document }
}

function serializeDocument(document) {
  return JSON.stringify(sanitizeDocument(document), null, 2) + "\n"
}

function restoreDocument(document, now, observedBucket) {
  var doc = sanitizeDocument(document)
  if (!doc.current) return { document: doc, record: null }
  if (doc.current.status === "paused") return { document: doc, record: null }
  var timestamp = finiteInteger(now, doc.current.settledThrough)
  if (timestamp < doc.current.settledThrough) {
    doc.current = shiftBackwardClock(doc.current, timestamp, doc.current.settledThrough)
    doc.current.bucket = normalizeBucket(observedBucket)
    return { document: doc, record: null }
  }
  doc.current = settleUnattributedGap(doc.current, timestamp, "recovery")
  if (timestamp >= doc.current.deadline) return finishDocument(doc, "expired", doc.current.deadline)
  doc.current.bucket = normalizeBucket(observedBucket)
  return { document: doc, record: null }
}

function periodBounds(period, now) {
  var date = new Date(finiteInteger(now, Date.now()))
  var start
  var end
  if (period === "today") {
    start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
  } else if (period === "week") {
    var mondayOffset = (date.getDay() + 6) % 7
    start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset)
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
  } else if (period === "month") {
    start = new Date(date.getFullYear(), date.getMonth(), 1)
    end = new Date(date.getFullYear(), date.getMonth() + 1, 1)
  } else {
    return { start: -Infinity, end: Infinity }
  }
  return { start: start.getTime(), end: end.getTime() }
}

function sessionsForPeriod(sessions, period, now) {
  var bounds = periodBounds(period, now)
  var out = []
  var rows = Array.isArray(sessions) ? sessions : []
  for (var i = 0; i < rows.length; i++) {
    var record = normalizeRecord(rows[i])
    if (record && record.startedAt >= bounds.start && record.startedAt < bounds.end) out.push(record)
  }
  out.sort(function(left, right) { return right.startedAt - left.startedAt })
  return out
}

function aggregate(sessions) {
  var result = { elapsedMilliseconds: 0, idleMilliseconds: 0, unattributedMilliseconds: 0, apps: {} }
  var rows = Array.isArray(sessions) ? sessions : []
  for (var i = 0; i < rows.length; i++) {
    var record = normalizeRecord(rows[i])
    if (!record) continue
    result.elapsedMilliseconds += record.elapsedMilliseconds
    result.idleMilliseconds += record.idleMilliseconds
    result.unattributedMilliseconds += record.unattributedMilliseconds
    for (var id in record.apps) {
      if (!Object.prototype.hasOwnProperty.call(record.apps, id)) continue
      var source = record.apps[id]
      var target = result.apps[id] || { name: source.name || id, milliseconds: 0 }
      target.milliseconds += source.milliseconds
      result.apps[id] = target
    }
  }
  return result
}

function durationRows(recordOrAggregate) {
  var value = recordOrAggregate || {}
  var rows = []
  var apps = value.apps || {}
  for (var id in apps) {
    if (!Object.prototype.hasOwnProperty.call(apps, id)) continue
    rows.push({ id: id, name: apps[id].name || id, milliseconds: apps[id].milliseconds || 0, kind: "app" })
  }
  if ((value.idleMilliseconds || 0) > 0)
    rows.push({ id: "idle", name: "Idle", milliseconds: value.idleMilliseconds, kind: "idle" })
  if ((value.unattributedMilliseconds || 0) > 0)
    rows.push({ id: "unattributed", name: "Unattributed", milliseconds: value.unattributedMilliseconds, kind: "unattributed" })
  rows.sort(function(left, right) {
    if (right.milliseconds !== left.milliseconds) return right.milliseconds - left.milliseconds
    return left.name.localeCompare(right.name)
  })
  return rows
}

var Session = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  MINUTE: MINUTE,
  emptyDocument: emptyDocument,
  appBucket: appBucket,
  idleBucket: idleBucket,
  unattributedBucket: unattributedBucket,
  sameBucket: sameBucket,
  validDurationMinutes: validDurationMinutes,
  newId: newId,
  startSession: startSession,
  settle: settle,
  transitionBucket: transitionBucket,
  settleUnattributedGap: settleUnattributedGap,
  shiftBackwardClock: shiftBackwardClock,
  remainingMilliseconds: remainingMilliseconds,
  pauseSession: pauseSession,
  resumeSession: resumeSession,
  invariant: invariant,
  totalAppMilliseconds: totalAppMilliseconds,
  recordFromCurrent: recordFromCurrent,
  addRecordOnce: addRecordOnce,
  finishDocument: finishDocument,
  cancelDocument: cancelDocument,
  sanitizeDocument: sanitizeDocument,
  parseDocument: parseDocument,
  serializeDocument: serializeDocument,
  restoreDocument: restoreDocument,
  periodBounds: periodBounds,
  sessionsForPeriod: sessionsForPeriod,
  aggregate: aggregate,
  durationRows: durationRows
}

if (typeof module !== "undefined" && module.exports) module.exports = Session
