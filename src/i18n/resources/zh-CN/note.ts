const note = {
  loading: "正在加载便签…",
  externalChange: {
    message: "此便签已在其他应用中更改。",
    reload: "加载更改",
    ignore: "保留当前内容",
  },
  actions: {
    retry: "重试",
    close: "关闭",
    cancel: "取消",
    discard: "放弃更改",
  },
  errors: {
    ended: "此便签已结束编辑。",
    missing: "便签文件已不存在。",
    conflict: "文件已在 Pinote 之外被修改。",
    io: "操作未能完成。",
    unknown: "无法确认操作结果，编辑已暂停。",
  },
  deletion: {
    title: "删除便签？",
    description: "文件将被永久删除。",
    confirm: "删除",
    dontAskAgain: "不再询问",
    preferencesFailed: "未能更新偏好，便签尚未删除。",
    preferencesUnavailable: "未能读取删除偏好，请确认是否删除。",
    failed: "未能删除便签。",
    cleanupFailed: "文件已删除，但清理未完成。",
  },
  discard: {
    title: "放弃更改？",
    description: "未保存的更改将丢失，文件会保留。",
  },
  status: {
    readOnly: "只读",
    alwaysOnTop: "始终置顶",
  },
} as const;

export default note;
