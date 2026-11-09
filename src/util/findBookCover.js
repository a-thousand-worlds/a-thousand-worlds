const BOOK_COVER_SEARCH_URL = process.env.VUE_APP_SEARCH_BOOK_COVER_URL

const fetchCover = async params => {
  if (!BOOK_COVER_SEARCH_URL) {
    return null
  }

  const query = new URLSearchParams(params).toString()
  const url = `${BOOK_COVER_SEARCH_URL}?${query}`
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return null
    }
    const json = await response.json()
    return json || null
  } catch (error) {
    return null
  }
}

export const findBookCoverByTitleAndAuthor = async (titleKeyword, authorKeyword) => {
  if (
    typeof titleKeyword !== 'string' ||
    !titleKeyword ||
    typeof authorKeyword !== 'string' ||
    !authorKeyword
  ) {
    return null
  }

  return fetchCover({ title: titleKeyword, author: authorKeyword })
}

export const getBookCoverByIsbn = async isbn => {
  if (!isbn) {
    return null
  }

  return fetchCover({ isbn })
}
