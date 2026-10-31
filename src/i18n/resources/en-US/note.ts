const note = {
  loading: "Loading note...",
  externalChange: {
    message: "This note was changed in another app.",
    reload: "Load changes",
    ignore: "Keep current content",
  },
  actions: {
    retry: "Retry",
    close: "Close",
    cancel: "Cancel",
    discard: "Discard",
  },
  errors: {
    ended: "Editing has ended for this note.",
    missing: "The note file no longer exists.",
    conflict: "The file changed outside Pinote.",
    io: "The operation could not be completed.",
    unknown: "The result could not be confirmed. Editing is paused.",
  },
  deletion: {
    title: "Delete note?",
    description: "The file will be permanently deleted.",
    confirm: "Delete",
    failed: "The note could not be deleted.",
    cleanupFailed: "The file was deleted, but cleanup failed.",
  },
  discard: {
    title: "Discard changes?",
    description: "Unsaved changes will be lost. The file will be kept.",
  },
  status: {
    readOnly: "Read-only",
    alwaysOnTop: "Always on top",
  },
} as const;

export default note;
