import QtQuick
import qs.Commons
import qs.Ui as Ui

Ui.BarWidget {
  id: root
  moduleName: "entroit.omafocus"

  readonly property var focusService: bar && bar.shell
    ? bar.shell.serviceFor(root.moduleName) : null
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item
    ? panelLoader.item.popoutSwitchClosing === true : false
  readonly property string displayText: {
    if (!focusService || !focusService.ready) return "◷"
    if (focusService.running) return focusService.formatClock(focusService.remainingMilliseconds)
    if (focusService.paused) return "Ⅱ " + focusService.formatClock(focusService.remainingMilliseconds)
    return "◷"
  }

  function open() {
    if (panelLoader.item) panelLoader.item.open()
  }

  function close() {
    if (panelLoader.item) panelLoader.item.close()
  }

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  function toggle() {
    if (panelLoader.item) panelLoader.item.toggle()
  }

  function injectPanel() {
    var panel = panelLoader.item
    if (!panel) return
    if ("bar" in panel) panel.bar = root.bar
    if ("anchorItem" in panel) panel.anchorItem = button
    if ("hostWidget" in panel) panel.hostWidget = root
    if ("service" in panel) panel.service = root.focusService
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onFocusServiceChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  Ui.WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.displayText
    active: root.focusService && root.focusService.running
    tooltipText: root.focusService && root.focusService.current && root.focusService.current.goal
      ? root.focusService.current.goal : "Oma Focus"
    onPressed: root.toggle()
  }
}
