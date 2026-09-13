import QtQuick
import QtQuick.Controls as QQC
import QtQuick.Layouts
import qs.Commons
import qs.Ui as Ui

Ui.Panel {
  id: root
  moduleName: "entroit.omafocus"

  property Item anchorItem: null
  property var hostWidget: null
  property var service: null
  property string page: "start"
  property int startMinutes: 50
  property string historyPeriod: "today"
  property var selectedRecord: null

  readonly property var current: service ? service.current : null
  readonly property var recapRecord: selectedRecord || (service ? service.lastRecap : null)
  readonly property var recapRows: service && recapRecord ? service.durationRows(recapRecord) : []
  readonly property var historySessions: {
    if (!service) return []
    service.revision
    return service.periodSessions(historyPeriod)
  }
  readonly property var historyTotals: service ? service.periodAggregate(historyPeriod) : ({})
  readonly property var historyRows: service ? service.durationRows(historyTotals) : []

  function showStart() {
    selectedRecord = null
    page = "start"
  }

  function showHistory() {
    selectedRecord = null
    page = "history"
  }

  function showRecap(record) {
    selectedRecord = record || null
    page = "recap"
  }

  function submitStart() {
    if (!service || !service.start(startMinutes, goalField.text)) return
    goalField.text = ""
    page = "active"
  }

  function formatDate(timestamp) {
    return Qt.formatDateTime(new Date(Number(timestamp)), "ddd d MMM, HH:mm")
  }

  onOpenedChanged: {
    if (!opened) return
    if (current) page = "active"
    else if (service && service.lastRecap) page = "recap"
    else if (page === "active") page = "start"
  }

  onCurrentChanged: {
    if (current) page = "active"
    else if (page === "active") page = service && service.lastRecap ? "recap" : "start"
  }

  Ui.KeyboardPanel {
    id: popup
    anchorItem: root.anchorItem
    bar: root.bar
    owner: root.hostWidget || root
    open: root.opened
    popoutSwitchClosing: root.popoutSwitchClosing
    focusTarget: keyCatcher
    contentWidth: fittedContentWidth(Style.space(440))
    contentHeight: cappedContentHeight(Style.space(540))

    Ui.PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: goalField.activeFocus || durationField.field.activeFocus
      onCloseRequested: root.close()

      Column {
        id: content
        anchors.fill: parent
        spacing: Style.space(12)

        Row {
          width: parent.width
          spacing: Style.space(8)

          Text {
            textFormat: Text.PlainText
            text: "OMA FOCUS"
            color: root.barForeground
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.title
            font.bold: true
            width: parent.width - navButtons.width - Style.space(8)
            anchors.verticalCenter: parent.verticalCenter
          }

          Row {
            id: navButtons
            spacing: Style.space(4)
            visible: !root.current

            Ui.Button {
              text: "Start"
              focusable: true
              selected: root.page === "start"
              foreground: root.barForeground
              onClicked: root.showStart()
            }
            Ui.Button {
              text: "History"
              focusable: true
              selected: root.page === "history"
              foreground: root.barForeground
              onClicked: root.showHistory()
            }
          }
        }

        Ui.PanelSeparator {
          width: parent.width
          foreground: root.barForeground
        }

        Column {
          width: parent.width
          spacing: Style.space(8)
          visible: !root.service || !root.service.ready

          Text {
            width: parent.width
            textFormat: Text.PlainText
            wrapMode: Text.WordWrap
            color: root.service && root.service.fatalError ? Color.urgent : root.barForeground
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.body
            text: root.service
              ? (root.service.fatalError || "Loading saved sessions…")
              : "Oma Focus needs the stock Omarchy bar to reach its service."
          }
        }

        Column {
          id: startView
          width: parent.width
          spacing: Style.space(12)
          visible: root.service && root.service.ready && !root.current && root.page === "start"

          Text {
            text: "How long do you want to focus?"
            textFormat: Text.PlainText
            color: root.barForeground
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.subtitle
          }

          Ui.NumberField {
            id: durationField
            label: "Minutes"
            value: root.startMinutes
            from: 1
            to: 240
            foreground: root.barForeground
            onModified: function(value) { root.startMinutes = value }
          }

          Ui.TextField {
            id: goalField
            width: parent.width
            placeholderText: "Goal (optional)"
            foreground: root.barForeground
            onAccepted: root.submitStart()
          }

          Text {
            width: parent.width
            textFormat: Text.PlainText
            wrapMode: Text.WordWrap
            text: "The goal is saved locally as plain text. Avoid secrets or sensitive details."
            color: Qt.darker(root.barForeground, 1.45)
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.bodySmall
          }

          Ui.Button {
            text: "Start focus session"
            focusable: true
            bordered: true
            foreground: root.barForeground
            onClicked: root.submitStart()
          }
        }

        Column {
          id: activeView
          width: parent.width
          spacing: Style.space(12)
          visible: root.service && root.service.ready && root.current && root.page === "active"

          Text {
            width: parent.width
            textFormat: Text.PlainText
            horizontalAlignment: Text.AlignHCenter
            text: root.service ? root.service.formatClock(root.service.remainingMilliseconds) : "00:00"
            color: root.barForeground
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.displayLarge
            font.bold: true
          }

          Text {
            width: parent.width
            visible: root.current && root.current.goal !== ""
            textFormat: Text.PlainText
            horizontalAlignment: Text.AlignHCenter
            elide: Text.ElideRight
            text: root.current ? root.current.goal : ""
            color: Qt.darker(root.barForeground, 1.25)
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.body
          }

          Text {
            width: parent.width
            textFormat: Text.PlainText
            horizontalAlignment: Text.AlignHCenter
            text: root.service && root.service.paused ? "Paused" : "Counting " + (root.current && root.current.bucket.kind === "app" ? root.current.bucket.name : (root.current && root.current.bucket.kind === "idle" ? "Idle" : "Unattributed"))
            color: Qt.darker(root.barForeground, 1.45)
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.bodySmall
          }

          Row {
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: Style.space(8)

            Ui.Button {
              text: root.service && root.service.paused ? "Resume" : "Pause"
              focusable: true
              bordered: true
              foreground: root.barForeground
              onClicked: {
                if (!root.service) return
                if (root.service.paused) root.service.resume()
                else root.service.pause()
              }
            }
            Ui.Button {
              text: "Finish"
              focusable: true
              bordered: true
              foreground: root.barForeground
              onClicked: root.service.finishEarly()
            }
            Ui.Button {
              text: "Cancel"
              focusable: true
              foreground: root.barForeground
              onClicked: root.service.cancel()
            }
          }

          Text {
            width: parent.width
            textFormat: Text.PlainText
            wrapMode: Text.WordWrap
            text: "Reading without keyboard or pointer input starts counting as Idle after 60 seconds."
            color: Qt.darker(root.barForeground, 1.55)
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.caption
          }
        }

        Column {
          id: recapView
          width: parent.width
          spacing: Style.space(8)
          visible: root.service && root.service.ready && !root.current && root.page === "recap"

          Text {
            width: parent.width
            textFormat: Text.PlainText
            text: root.recapRecord
              ? (root.recapRecord.outcome === "expired" ? "Session complete" : "Finished early")
              : "No session selected"
            color: root.barForeground
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.subtitle
            font.bold: true
          }

          Text {
            width: parent.width
            visible: root.recapRecord && root.recapRecord.goal !== ""
            textFormat: Text.PlainText
            elide: Text.ElideRight
            text: root.recapRecord ? root.recapRecord.goal : ""
            color: Qt.darker(root.barForeground, 1.25)
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.body
          }

          Text {
            width: parent.width
            textFormat: Text.PlainText
            text: root.recapRecord
              ? root.formatDate(root.recapRecord.startedAt) + "  ·  " + root.service.formatDuration(root.recapRecord.elapsedMilliseconds)
              : ""
            color: Qt.darker(root.barForeground, 1.45)
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.bodySmall
          }

          QQC.ScrollView {
            width: parent.width
            height: Style.space(245)
            clip: true

            ListView {
              id: recapList
              model: root.recapRows
              spacing: Style.space(4)

              delegate: Item {
                required property var modelData
                width: recapList.width
                height: Style.space(30)

                Text {
                  anchors.left: parent.left
                  anchors.verticalCenter: parent.verticalCenter
                  width: parent.width - Style.space(100)
                  textFormat: Text.PlainText
                  elide: Text.ElideRight
                  text: modelData.name
                  color: root.barForeground
                  font.family: root.bar ? root.bar.fontFamily : Style.font.family
                  font.pixelSize: Style.font.body
                }
                Text {
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  textFormat: Text.PlainText
                  text: root.service.formatDuration(modelData.milliseconds)
                  color: Qt.darker(root.barForeground, 1.3)
                  font.family: root.bar ? root.bar.fontFamily : Style.font.family
                  font.pixelSize: Style.font.body
                }
              }
            }
          }

          Text {
            width: parent.width
            visible: root.recapRecord && (root.recapRecord.recoveryMilliseconds > 0 || root.recapRecord.discontinuityMilliseconds > 0 || root.recapRecord.clockDiscontinuities > 0)
            textFormat: Text.PlainText
            wrapMode: Text.WordWrap
            text: root.recapRecord
              ? "Some time was recovered or affected by a clock gap and is shown as Unattributed."
              : ""
            color: Color.urgent
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.caption
          }

          Row {
            spacing: Style.space(8)
            Ui.Button {
              text: "New session"
              focusable: true
              foreground: root.barForeground
              onClicked: root.showStart()
            }
            Ui.Button {
              text: "History"
              focusable: true
              foreground: root.barForeground
              onClicked: root.showHistory()
            }
          }
        }

        Column {
          id: historyView
          width: parent.width
          spacing: Style.space(8)
          visible: root.service && root.service.ready && !root.current && root.page === "history"

          Row {
            spacing: Style.space(4)
            Repeater {
              model: [
                { key: "today", label: "Today" },
                { key: "week", label: "Week" },
                { key: "month", label: "Month" },
                { key: "all", label: "All" }
              ]
              Ui.Button {
                required property var modelData
                text: modelData.label
                focusable: true
                selected: root.historyPeriod === modelData.key
                foreground: root.barForeground
                onClicked: root.historyPeriod = modelData.key
              }
            }
          }

          Text {
            width: parent.width
            textFormat: Text.PlainText
            text: root.historySessions.length + (root.historySessions.length === 1 ? " session" : " sessions") + "  ·  " + root.service.formatDuration(root.historyTotals.elapsedMilliseconds || 0)
            color: root.barForeground
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.subtitle
          }

          Text {
            width: parent.width
            textFormat: Text.PlainText
            elide: Text.ElideRight
            text: root.historyRows.length > 0
              ? root.historyRows.slice(0, 3).map(function(row) { return row.name + " " + root.service.formatDuration(row.milliseconds) }).join("  ·  ")
              : "No recorded time in this period"
            color: Qt.darker(root.barForeground, 1.35)
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.bodySmall
          }

          QQC.ScrollView {
            width: parent.width
            height: Style.space(285)
            clip: true

            ListView {
              id: historyList
              model: root.historySessions
              spacing: Style.space(4)

              delegate: Ui.Button {
                required property var modelData
                width: historyList.width
                leftAlign: true
                focusable: true
                foreground: root.barForeground
                text: root.formatDate(modelData.startedAt) + "  ·  " + root.service.formatDuration(modelData.elapsedMilliseconds) + (modelData.goal ? "  ·  " + modelData.goal : "")
                onClicked: root.showRecap(modelData)
              }
            }
          }

          Text {
            width: parent.width
            textFormat: Text.PlainText
            wrapMode: Text.WordWrap
            text: "Sessions belong to the local date they started. Weeks begin Monday. Manual export: copy " + root.service.dataPath
            color: Qt.darker(root.barForeground, 1.55)
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.caption
          }

          Ui.Button {
            text: "Clear saved history"
            focusable: true
            foreground: Color.urgent
            enabled: root.service.sessions.length > 0
            onClicked: clearConfirmation.opened = true
          }
        }

        Row {
          width: parent.width
          spacing: Style.space(8)
          visible: root.service && root.service.saveError !== ""

          Text {
            width: parent.width - retryButton.width - Style.space(8)
            textFormat: Text.PlainText
            wrapMode: Text.WordWrap
            text: root.service ? root.service.saveError : ""
            color: Color.urgent
            font.family: root.bar ? root.bar.fontFamily : Style.font.family
            font.pixelSize: Style.font.caption
          }
          Ui.Button {
            id: retryButton
            text: "Retry"
            focusable: true
            foreground: root.barForeground
            onClicked: root.service.retrySave()
          }
        }
      }

      Ui.ConfirmDialog {
        id: clearConfirmation
        anchors.fill: parent
        message: "Delete every saved Oma Focus session? An active session will be kept."
        confirmText: "Delete"
        foreground: root.barForeground
        onCanceled: opened = false
        onConfirmed: {
          opened = false
          root.service.clearHistory()
        }
      }
    }
  }
}
