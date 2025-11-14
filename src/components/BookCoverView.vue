<script>
import CreatorsWidget from '@/components/CreatorsWidget'
import BookmarkButton from '@/components/BookmarkButton'
import BookDetailLink from '@/components/BookDetailLink'

export default {
  components: {
    CreatorsWidget,
    BookmarkButton,
    BookDetailLink,
  },
  props: ['book'],
  emits: ['loaded'],
  data() {
    return {
      // if the main image fails to load, this gets set to true and the fallback image is used
      imgErrored: false,
    }
  },
  computed: {
    bgImage() {
      return this.hasBookCoverUrl
        ? this.book.cover.cache || this.book.cover.url
        : this.book.cover || ''
    },
    bgFallback() {
      if (this.hasBookCoverUrl) return this.book.cover.url
      return this.book.cover || ''
    },
    coverRatio() {
      if (this.hasBookCoverUrl) return (this.book.cover?.height / this.book.cover?.width) * 100
      if (!this.book || !this.book.coverWidth || !this.book.coverHeight) {
        return 1
      }
      return (this.book.coverHeight / this.book.coverWidth) * 100
    },
    hasBookCoverUrl() {
      return this.book.cover?.url?.startsWith('http')
    },
  },
  created() {
    const img = new Image()
    img.onload = () => {
      this.$emit('loaded', this.book)
    }
    img.onerror = () => {
      this.imgErrored = true
    }
    img.src = this.bgImage
  },
}
</script>

<template>
  <BookDetailLink :book="book">
    <div
      :style="{
        width: '100%',
        paddingTop: coverRatio + '%',
        backgroundImage: `url(${imgErrored ? bgFallback : bgImage})`,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundColor: bgImage ? 'transparent' : null,
        minHeight: !bgImage ? '200px' : null,
      }"
      class="book-cover-wrapper bg-secondary"
    >
      <div class="cover-shadow" />
      <div class="cover-data">
        <div class="title">{{ book.title }}</div>
        <div class="authors">
          <CreatorsWidget :book="book" />
        </div>
      </div>
      <div class="bookmark">
        <BookmarkButton :book="book" />
      </div>
    </div>

    <div class="is-hidden-tablet">
      <div class="divider-bottom is-flex is-justify-content-space-between">
        <div>
          <h1 class="title">{{ book.title }}</h1>
          <CreatorsWidget :book="book" />
        </div>
        <div style="padding-top: 0px"><BookmarkButton :book="book" /></div>
      </div>
    </div>
  </BookDetailLink>
</template>

<style lang="scss" scoped>
@use 'bulma/sass/utilities/mixins' as *;
@use '@/assets/style/vars.scss' as *;

.book-cover-wrapper {
  margin-bottom: 10px;
  background-size: contain;
  background-repeat: no-repeat;

  .cover-shadow,
  .cover-data,
  .bookmark {
    opacity: 0;
    transition: opacity 0.2s ease-in-out;
  }

  .cover-shadow,
  .cover-data {
    position: absolute;
    top: 0;
    left: 0;
    // set no width and height until hovered
    // see &:hover below
    width: 0;
    height: 0;
  }

  .cover-data {
    // set padding-bottom to 0 so that scrolling overflow content is flush with the bottom of the cover image
    padding: 20px 20px 0 20px;
    overflow: scroll;

    .title {
      font-size: 1.2rem;
      font-weight: 500;

      // since the book covers scale with viewport width, use vw units for font size
      @include from($tablet) {
        font-size: 2vw;
      }
    }
  }

  .cover-shadow {
    background: #fff;
  }

  // only set position to relative and set width and height of .cover-shadow and .cover-data on hover
  // otherwise, the book cover overlaps tag submenus regardless of z-index due to source order
  &:hover {
    position: relative;
    top: 0;
    left: 0;
    .bookmark {
      opacity: 1;
    }
    .cover-shadow {
      opacity: 0.8;
    }
    .cover-data {
      opacity: 1;
    }
    .cover-shadow,
    .cover-data {
      width: 100%;
      height: 100%;
    }
  }

  .bookmark {
    position: absolute;
    bottom: 10px;
    right: 10px;
  }
}
</style>
