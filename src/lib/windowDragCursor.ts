function setWindowDragCursor(active: boolean) {
  if (active) document.documentElement.dataset.windowDragging = "true";
  else delete document.documentElement.dataset.windowDragging;
}

function clearAfterRelease(event: MouseEvent) {
  if (event.buttons !== 0) return;
  window.removeEventListener("mousemove", clearAfterRelease, true);
  setWindowDragCursor(false);
}

export function showWindowDragCursor() {
  setWindowDragCursor(true);
}

export function hideWindowDragCursor() {
  window.removeEventListener("mousemove", clearAfterRelease, true);
  setWindowDragCursor(false);
}

export function showWindowDragCursorUntilRelease() {
  setWindowDragCursor(true);
  window.addEventListener("mousemove", clearAfterRelease, true);
}
