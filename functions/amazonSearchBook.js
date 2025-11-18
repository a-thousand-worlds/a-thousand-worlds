const express = require('express')
const chromium = require('@sparticuz/chromium')
const cheerio = require('cheerio')

// amazon uses '+' char to separate keywords in url, not %20 encoded 'space'
const amazonSearchUrl = keywords =>
  `https://www.amazon.com/s?k=${keywords
    .split(' ')
    .map(el => encodeURIComponent(el))
    .join('+')}&i=stripbooks&s=relevanceexprank&unfiltered=1&ref=sr_adv_b`

const parseSrcset = srcset => {
  if (!srcset) return null
  return srcset
    .split(', ')
    .map(d => d.split(' '))
    .reduce((p, c) => {
      if (c.length !== 2) {
        // throw new Error("Error parsing srcset.");
        return p
      }
      p[c[1]] = c[0]
      return p
    }, {})
}

let puppeteer = null
const getPuppeteer = () => {
  if (!puppeteer) {
    puppeteer = require('puppeteer-extra')
    puppeteer.use(require('puppeteer-extra-plugin-stealth')())
  }
  return puppeteer
}

module.exports = () => {
  const app = express()

  app.get('/', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*')

    if (!req.query || !req.query.keyword) {
      res.send(JSON.stringify(null))
      return
    }
    console.log(`searching book isbn for [${req.query.keyword}]`)
    const keywords = req.query.keyword

    const browser = await getPuppeteer().launch({
      args: [...chromium.args, '--no-sandbox'],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 3 },
    })

    if (!browser) {
      console.log('browser is not loaded')
      return
    }

    const page = await browser.newPage()
    // mimic a real browser to avoid Amazon bot detection
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', // common User Agent
    )
    await page.setViewport({ width: 1280, height: 720 })
    await page.setExtraHTTPHeaders({
      'accept-language': 'en-US,en;q=0.9',
    })
    let result = null
    try {
      console.log('URL: ', amazonSearchUrl(keywords))
      await page.goto(amazonSearchUrl(keywords), {
        waitUntil: 'domcontentloaded',
      })
      const pageHtml = await page.content()
      const $ = cheerio.load(pageHtml)

      let $el = null
      let isbn = null
      $('div.s-result-item').each(function (i, $result) {
        const asin = $(this).data('asin')
        // let's check that element is book in next way - "book result" should include one of format keyword
        const text = $(this).text()
        const isBook = ['Hardcover', 'Paperback', 'Board book'].some(format =>
          text.includes(format),
        )
        if (asin && `${asin}`.length && !$el && isBook) {
          $el = $(this)
          // data-asin may contain an ASIN instead of an ISBN
          // rather than look up the ISBN here, where it would slow down the response, we can look it up after it has been submitted
          isbn = asin
        }
      })
      if (!isbn || !$el) {
        console.log('nothing found', keywords)
      } else {
        const $imgSpan = $('span[data-component-type="s-product-image"]', $el)
        const $a = $('a', $imgSpan)
        const bookUrl = $a.attr('href')
        const $img = $('img', $imgSpan)
        const covers = parseSrcset($img.attr('srcset')) || {}

        const maxCoverSize = ['3x', '2.5x', '2x', '1.5x', '1x'].find(size => covers[size])
        const maxCover = maxCoverSize ? covers[maxCoverSize] : null
        const $title = $('h2', $el)
        const title = $title.text()
        if (bookUrl && maxCover && title) {
          result = {
            title: title.trim(),
            url: `https://amazon.com${bookUrl.split('?')[0]}`,
            isbn,
            thumbnail: maxCover,
          }
        }
      }
    } catch (err) {
      console.error('error on amazon scraping', err)
      result = null
    }
    await browser.close()
    console.log('search result', result)
    res.json(result)
  })

  return app
}
