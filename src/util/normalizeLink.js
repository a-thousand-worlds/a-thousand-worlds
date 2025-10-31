/** Normalizes a url with support for missing protocol (xyz.com) and Twitter handles (@twitter_handle) */
const normalizeLink = link => {
  if (!link) return link
  return link.startsWith('http')
    ? link
    : link.startsWith('@')
    ? `https://twitter.com/${link.slice(1)}`
    : `https://${link}`
}

export default normalizeLink
