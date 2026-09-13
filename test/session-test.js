"use strict"

const assert = require("node:assert/strict")
const Session = require("../src/session.js")

function balanced(current) {
  assert.equal(Session.invariant(current), true, "accounting invariant")
}

function run(name, test) {
  test()
  process.stdout.write(`ok - ${name}\n`)
}

run("A to B to idle to B accounts for every millisecond", () => {
  let current = Session.startSession("sequence", "Synthetic review", 1, 0, Session.appBucket("a", "App A"))
  balanced(current)
  current = Session.transitionBucket(current, Session.appBucket("b", "App B"), 10000)
  balanced(current)
  current = Session.transitionBucket(current, Session.idleBucket(), 25000)
  balanced(current)
  current = Session.transitionBucket(current, Session.appBucket("b", "App B"), 40000)
  balanced(current)
  const result = Session.finishDocument({ schemaVersion: 1, current, sessions: [] }, "expired", 60000)
  assert.equal(result.record.apps.a.milliseconds, 10000)
  assert.equal(result.record.apps.b.milliseconds, 35000)
  assert.equal(result.record.idleMilliseconds, 15000)
  assert.equal(result.record.unattributedMilliseconds, 0)
  assert.equal(result.record.elapsedMilliseconds, 60000)
})

run("pause excludes time and resume preserves the remainder", () => {
  let current = Session.startSession("pause", "", 1, 0, Session.appBucket("a", "A"))
  current = Session.pauseSession(current, 10000)
  balanced(current)
  assert.equal(Session.remainingMilliseconds(current, 20000), 50000)
  assert.deepEqual(Session.pauseSession(current, 30000), current)
  current = Session.resumeSession(current, 30000, Session.appBucket("b", "B"))
  assert.equal(current.deadline, 80000)
  current = Session.settle(current, 50000)
  balanced(current)
  assert.equal(current.elapsedMilliseconds, 30000)
  assert.equal(current.apps.a.milliseconds, 10000)
  assert.equal(current.apps.b.milliseconds, 20000)
})

run("finish early, cancel, and duplicate finalization are idempotent", () => {
  let current = Session.startSession("once", "", 1, 0, Session.unattributedBucket())
  const first = Session.finishDocument({ schemaVersion: 1, current, sessions: [] }, "finished-early", 5000)
  assert.equal(first.record.outcome, "finished-early")
  assert.equal(first.document.sessions.length, 1)
  const replay = Session.addRecordOnce(first.document, first.record)
  assert.equal(replay.sessions.length, 1)
  const noCurrent = Session.finishDocument(first.document, "finished-early", 6000)
  assert.equal(noCurrent.record, null)
  current = Session.startSession("cancel", "", 1, 0, Session.idleBucket())
  const canceled = Session.cancelDocument({ schemaVersion: 1, current, sessions: first.document.sessions })
  assert.equal(canceled.current, null)
  assert.equal(canceled.sessions.length, 1)
})

run("missing focus, exact expiration, and late events stay capped", () => {
  let current = Session.startSession("deadline", "", 1, 0, Session.appBucket("", "Leaked title"))
  assert.equal(current.bucket.kind, "unattributed")
  current = Session.transitionBucket(current, Session.unattributedBucket(), 0)
  current = Session.settle(current, 60000)
  balanced(current)
  assert.equal(current.elapsedMilliseconds, 60000)
  const late = Session.transitionBucket(current, Session.appBucket("late", "Late"), 90000)
  assert.equal(late.elapsedMilliseconds, 60000)
  assert.equal(late.apps.late, undefined)
})

run("invalid durations are rejected", () => {
  for (const value of [0, 241, 1.5, NaN, "ten"])
    assert.throws(() => Session.startSession("bad", "", value, 0, Session.idleBucket()))
  assert.doesNotThrow(() => Session.startSession("good", "", 1, 0, Session.idleBucket()))
  assert.doesNotThrow(() => Session.startSession("good", "", 240, 0, Session.idleBucket()))
})

run("running recovery attributes its gap once and expires once", () => {
  let current = Session.startSession("recover", "", 1, 0, Session.appBucket("a", "A"))
  current = Session.settle(current, 10000)
  const restored = Session.restoreDocument({ schemaVersion: 1, current, sessions: [] }, 40000, Session.appBucket("b", "B"))
  assert.equal(restored.document.current.recoveryMilliseconds, 30000)
  assert.equal(restored.document.current.unattributedMilliseconds, 30000)
  assert.equal(restored.document.current.bucket.appId, "b")
  const expired = Session.restoreDocument(restored.document, 90000, Session.appBucket("b", "B"))
  assert.equal(expired.document.sessions.length, 1)
  assert.equal(expired.document.sessions[0].elapsedMilliseconds, 60000)
  assert.equal(expired.document.sessions[0].unattributedMilliseconds, 50000)
  const replay = Session.restoreDocument(expired.document, 100000, Session.appBucket("b", "B"))
  assert.equal(replay.document.sessions.length, 1)
})

run("paused recovery adds no time", () => {
  let current = Session.startSession("paused-recovery", "", 1, 0, Session.appBucket("a", "A"))
  current = Session.pauseSession(current, 12000)
  const restored = Session.restoreDocument({ schemaVersion: 1, current, sessions: [] }, 90000, Session.appBucket("b", "B"))
  assert.deepEqual(restored.document.current, current)
})

run("forward and backward discontinuities do not credit the last app", () => {
  let current = Session.startSession("clock", "", 1, 10000, Session.appBucket("a", "A"))
  current = Session.settle(current, 11000)
  current = Session.settleUnattributedGap(current, 30000, "discontinuity")
  assert.equal(current.apps.a.milliseconds, 1000)
  assert.equal(current.unattributedMilliseconds, 19000)
  current = Session.shiftBackwardClock(current, 20000, 30000)
  assert.equal(current.deadline, 60000)
  assert.equal(current.settledThrough, 20000)
  assert.equal(current.clockDiscontinuities, 1)
  balanced(current)
})

run("history periods use local starts, Monday weeks, and session start dates", () => {
  function record(id, start, elapsed = 1000) {
    const current = Session.startSession(id, "", 1, start, Session.appBucket("a", "A"))
    return Session.recordFromCurrent(Session.settle(current, start + elapsed), "finished-early", start + elapsed)
  }
  const now = new Date(2026, 8, 16, 12).getTime() // Wednesday
  const sunday = record("sun", new Date(2026, 8, 13, 23, 59).getTime())
  const monday = record("mon", new Date(2026, 8, 14, 0, 0).getTime())
  const today = record("today", new Date(2026, 8, 16, 1).getTime())
  assert.deepEqual(Session.sessionsForPeriod([sunday, monday, today], "week", now).map(row => row.id), ["today", "mon"])
  assert.deepEqual(Session.sessionsForPeriod([sunday, monday, today], "today", now).map(row => row.id), ["today"])

  const crossMidnight = record("cross", new Date(2026, 8, 15, 23, 59, 59).getTime())
  assert.equal(Session.sessionsForPeriod([crossMidnight], "today", now).length, 0)
  const august = record("aug", new Date(2026, 7, 31, 23, 59).getTime())
  assert.equal(Session.sessionsForPeriod([august, today], "month", now).length, 1)
  const priorYear = record("prior", new Date(2025, 11, 31, 23, 59).getTime())
  assert.equal(Session.sessionsForPeriod([priorYear, today], "month", now).length, 1)
})

run("daylight-saving days use calendar boundaries", () => {
  const now = new Date(2026, 2, 29, 12).getTime()
  const bounds = Session.periodBounds("today", now)
  assert.equal(bounds.end - bounds.start, 23 * 60 * 60 * 1000)
})

run("aggregation and empty history return exact totals", () => {
  assert.deepEqual(Session.aggregate([]), {
    elapsedMilliseconds: 0,
    idleMilliseconds: 0,
    unattributedMilliseconds: 0,
    apps: {}
  })
  let one = Session.startSession("one", "", 1, 0, Session.appBucket("a", "A"))
  one = Session.transitionBucket(one, Session.idleBucket(), 10000)
  one = Session.settle(one, 15000)
  let two = Session.startSession("two", "", 1, 20000, Session.appBucket("a", "A"))
  two = Session.settle(two, 27000)
  const totals = Session.aggregate([
    Session.recordFromCurrent(one, "finished-early", 15000),
    Session.recordFromCurrent(two, "finished-early", 27000)
  ])
  assert.equal(totals.elapsedMilliseconds, 22000)
  assert.equal(totals.apps.a.milliseconds, 17000)
  assert.equal(totals.idleMilliseconds, 5000)
})

run("persistence strips titles, URLs, and unknown metadata", () => {
  let current = Session.startSession("private", "Synthetic goal", 1, 0, Session.appBucket("browser", "Browser"))
  current = Session.settle(current, 1000)
  current.windowTitle = "Secret title"
  current.url = "https://example.test/private"
  current.apps.browser.title = "Secret tab"
  current.apps.browser.url = "https://example.test/tab"
  const raw = Session.serializeDocument({ schemaVersion: 1, current, sessions: [], telemetry: "no" })
  assert.equal(raw.includes("Secret"), false)
  assert.equal(raw.includes("https://"), false)
  assert.equal(raw.includes("telemetry"), false)
  const parsed = Session.parseDocument(raw)
  assert.equal(parsed.error, "")
  assert.equal(parsed.document.current.id, "private")
  assert.equal(parsed.document.current.apps.browser.milliseconds, 1000)
})

run("malformed and newer-schema documents remain errors", () => {
  assert.match(Session.parseDocument("{").error, /valid JSON/)
  assert.match(Session.parseDocument('{"schemaVersion":2,"current":null,"sessions":[]}').error, /newer/)
})

run("five thousand compact sessions remain responsive", () => {
  const sessions = []
  const start = new Date(2026, 0, 1).getTime()
  for (let index = 0; index < 5000; index++) {
    let current = Session.startSession(`synthetic-${index}`, "Synthetic", 1, start + index * 60000, Session.appBucket(`app-${index % 20}`, `App ${index % 20}`))
    current = Session.settle(current, current.startedAt + 60000)
    sessions.push(Session.recordFromCurrent(current, "expired", current.deadline))
  }
  const before = process.hrtime.bigint()
  const raw = Session.serializeDocument({ schemaVersion: 1, current: null, sessions })
  const parsed = Session.parseDocument(raw)
  const totals = Session.aggregate(parsed.document.sessions)
  const milliseconds = Number(process.hrtime.bigint() - before) / 1e6
  assert.equal(parsed.document.sessions.length, 5000)
  assert.equal(totals.elapsedMilliseconds, 5000 * 60000)
  process.stdout.write(`  5,000-session serialize/parse/aggregate: ${milliseconds.toFixed(1)} ms\n`)
})
