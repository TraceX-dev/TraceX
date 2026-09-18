export const escape = (str: string): string => {
  try {
    return str
      .replace(/&/gv, '&amp;')
      .replace(/</gv, '&lt;')
      .replace(/>/gv, '&gt;')
      .replace(/"/gv, '&quot;')
      .replace(/'/gv, '&#x27;')
  } catch (e) {
    console.error(e)
  }
  return str
}

export const unescape = (str: string): string =>
  str
    .replace(/&lt;/gv, '<')
    .replace(/&gt;/gv, '>')
    .replace(/&quot;/gv, '"')
    .replace(/&#x27;/gv, "'")
    .replace(/&amp;/gv, '&')
